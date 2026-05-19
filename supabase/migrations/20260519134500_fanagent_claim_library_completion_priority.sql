-- Prioritize queue claims that complete user-visible libraries.
-- Legacy recovery can leave many old batches with one pending slot each. A pure
-- scheduled_at order makes newer or nearly-complete libraries wait behind every
-- older recovered row. This ordering keeps in-progress stages first, then drains
-- batches closest to a complete finalized library.

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

grant execute on function public.claim_generation_items(integer, text, integer) to service_role;

comment on function public.claim_generation_items(integer, text, integer)
  is 'Atomically claims due FanAgent generation queue rows for service-role workers using FOR UPDATE SKIP LOCKED. Prioritizes in-progress work and batches closest to a complete video library.';
