-- Make campaign launch drain the just-created render queue immediately while
-- keeping calendar/post timing as separate editable draft rows.

drop function if exists public.claim_generation_items(integer, text, integer);

create or replace function public.claim_generation_items(
  p_limit integer default 5,
  p_worker_id text default null,
  p_claim_window_minutes integer default 15,
  p_batch_id uuid default null
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
    left join lateral (
      select
        count(vli.id) as slot_count,
        count(vli.id) filter (where vli.status in ('ready','scheduled','posted')) as ready_count
      from public.video_library_items vli
      where vli.batch_id = gi.batch_id
    ) library_progress on true
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
      and (p_batch_id is null or gi.batch_id = p_batch_id)
      and gb.paused_at is null
      and coalesce(gi.attempt_count, 0) < coalesce(gi.max_attempts, 3)
      and (
        gi.locked_at is null
        or gi.locked_at < now() - make_interval(mins => greatest(1, p_claim_window_minutes))
      )
    order by
      case
        when gi.status in ('ready','stitched','rendering','generating','picking_stock','sourcing','transcribing','planning')
          then 0
        else 1
      end asc,
      coalesce(
        library_progress.ready_count::numeric / nullif(library_progress.slot_count, 0),
        0
      ) desc,
      coalesce(gb.updated_at, gb.created_at) desc,
      gi.scheduled_at asc,
      gi.created_at asc
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

revoke all on function public.claim_generation_items(integer, text, integer, uuid) from public;
revoke all on function public.claim_generation_items(integer, text, integer, uuid) from anon;
revoke all on function public.claim_generation_items(integer, text, integer, uuid) from authenticated;
grant execute on function public.claim_generation_items(integer, text, integer, uuid) to service_role;

comment on function public.claim_generation_items(integer, text, integer, uuid)
  is 'Atomically claims due FanAgent generation queue rows, optionally scoped to a just-launched batch for immediate library rendering.';

create index if not exists idx_posts_library_item_id
  on public.posts(library_item_id)
  where library_item_id is not null;

create index if not exists idx_posts_generation_item_id
  on public.posts(generation_item_id)
  where generation_item_id is not null;

create index if not exists idx_posts_pending_blocked_schedule
  on public.posts(status, publish_status, scheduled_at)
  where status = 'pending'
    and publish_status in (
      'blocked_render_not_ready',
      'blocked_review_required',
      'blocked_account_not_connected',
      'blocked_missing_video',
      'blocked_missing_privacy'
    );
