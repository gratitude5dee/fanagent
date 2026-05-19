-- Move FanAgent generation recovery into the database so one repair request is
-- atomic and does not fan out into many edge-to-REST calls.

drop index if exists public.idx_generation_items_due_claim;

create index if not exists idx_generation_items_due_claim
  on public.generation_items (scheduled_at, created_at)
  where status in (
    'pending',
    'planning',
    'transcribing',
    'sourcing',
    'picking_stock',
    'generating',
    'rendering',
    'stitched',
    'ready'
  );

create or replace function public.claim_generation_items(
  p_limit integer default 5,
  p_worker_id text default null,
  p_claim_window_minutes integer default 15
)
returns setof public.generation_items
language sql
security invoker
set search_path = public
as $$
  with candidates as (
    select gi.id
    from public.generation_items gi
    join public.generation_batches gb on gb.id = gi.batch_id
    where gi.status in (
        'pending',
        'planning',
        'transcribing',
        'sourcing',
        'picking_stock',
        'generating',
        'rendering',
        'stitched',
        'ready'
      )
      and gi.scheduled_at <= now() + interval '60 minutes'
      and gb.paused_at is null
      and coalesce(gi.attempt_count, 0) < coalesce(gi.max_attempts, 3)
      and (
        gi.locked_at is null
        or gi.locked_at < now() - make_interval(mins => greatest(1, p_claim_window_minutes))
      )
    order by gi.scheduled_at asc, gi.created_at asc
    limit greatest(1, least(coalesce(p_limit, 5), 50))
    for update of gi skip locked
  ),
  updated as (
    update public.generation_items gi
    set
      locked_at = now(),
      locked_by = coalesce(nullif(p_worker_id, ''), 'fanpage-generate-due'),
      last_attempt_at = now(),
      attempt_count = coalesce(gi.attempt_count, 0) + 1,
      status = case when gi.status = 'pending' then 'planning' else gi.status end,
      updated_at = now()
    from candidates
    where gi.id = candidates.id
    returning gi.*
  )
  select * from updated;
$$;

create or replace function public.recover_generation_items(
  p_since timestamptz default '2026-05-12T00:00:00.000Z',
  p_limit integer default 25,
  p_include_failed boolean default true,
  p_include_stale_active boolean default true
)
returns table(id uuid, recovered_from text, library_item_id uuid)
language sql
security invoker
set search_path = public
as $$
  with candidates as (
    select
      gi.id,
      gi.status::text as recovered_from,
      gi.library_item_id,
      gi.error_message
    from public.generation_items gi
    where gi.post_id is null
      and gi.updated_at >= coalesce(p_since, '2026-05-12T00:00:00.000Z'::timestamptz)
      and (
        (coalesce(p_include_failed, true) and gi.status = 'failed')
        or (
          coalesce(p_include_stale_active, true)
          and gi.status in (
            'pending',
            'planning',
            'transcribing',
            'sourcing',
            'picking_stock',
            'generating',
            'rendering',
            'stitched',
            'ready'
          )
          and (
            coalesce(gi.attempt_count, 0) >= coalesce(gi.max_attempts, 3)
            or gi.locked_at < now() - interval '10 minutes'
          )
        )
      )
    order by gi.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 25), 250))
    for update of gi skip locked
  ),
  clear_uses as (
    delete from public.source_candidate_uses scu
    using candidates c
    where scu.generation_item_id = c.id
    returning scu.id
  ),
  reset_library as (
    update public.video_library_items vli
    set
      status = 'not_ready',
      final_asset_id = null,
      thumbnail_url = null,
      segments = '[]'::jsonb,
      provenance = '[]'::jsonb,
      reused_flags = '{}'::jsonb,
      perceptual_hash = null,
      default_caption = null,
      default_hashtags = '{}'::text[],
      metadata = coalesce(vli.metadata, '{}'::jsonb) || jsonb_build_object(
        'recovered_from_generation_status',
        'recoverRecentFailures',
        'recovered_at',
        now()
      ),
      updated_at = now()
    from candidates c
    where vli.id = c.library_item_id
    returning vli.id
  ),
  reset_generation as (
    update public.generation_items gi
    set
      status = 'pending',
      segments = null,
      stock_clip_url = null,
      render_job_id = null,
      final_asset_id = null,
      provider_request_id = null,
      error_message = null,
      attempt_count = 0,
      max_attempts = greatest(
        coalesce(gi.max_attempts, 3),
        case
          when coalesce(gi.error_message, '') ~* '(IDLE_TIMEOUT|timeout|object exceeded|network|connection reset|502|504|520)'
            then 5
          else 3
        end
      ),
      locked_at = null,
      locked_by = null,
      last_attempt_at = null,
      stage_events = (
        case
          when jsonb_typeof(coalesce(gi.stage_events, '[]'::jsonb)) = 'array'
            then coalesce(gi.stage_events, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) || jsonb_build_array(jsonb_build_object(
        'stage',
        'recovered',
        'at',
        now(),
        'reason',
        'live repair',
        'recoveredFrom',
        c.recovered_from
      )),
      updated_at = now()
    from candidates c
    where gi.id = c.id
    returning gi.id, c.recovered_from, c.library_item_id
  )
  select reset_generation.id, reset_generation.recovered_from, reset_generation.library_item_id
  from reset_generation;
$$;

revoke all on function public.claim_generation_items(integer, text, integer) from public;
revoke all on function public.claim_generation_items(integer, text, integer) from anon;
revoke all on function public.claim_generation_items(integer, text, integer) from authenticated;
grant execute on function public.claim_generation_items(integer, text, integer) to service_role;

revoke all on function public.recover_generation_items(timestamptz, integer, boolean, boolean) from public;
revoke all on function public.recover_generation_items(timestamptz, integer, boolean, boolean) from anon;
revoke all on function public.recover_generation_items(timestamptz, integer, boolean, boolean) from authenticated;
grant execute on function public.recover_generation_items(timestamptz, integer, boolean, boolean) to service_role;

comment on function public.recover_generation_items(timestamptz, integer, boolean, boolean)
  is 'Atomically resets failed or stale active FanAgent generation queue rows, clears source candidate uses, and resets linked library items.';
