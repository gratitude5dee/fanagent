-- Recompute generation batch rollups from their authoritative item/library rows.
-- This cleans up legacy batches that were recovered after they had already been
-- marked terminal, leaving stale completed_at timestamps while work resumed.

with generation_rollups as (
  select
    gb.id,
    count(gi.id) as item_count,
    count(gi.id) filter (where gi.status = 'complete') as complete_count,
    count(gi.id) filter (where gi.status in ('failed','skipped')) as failed_count,
    count(gi.id) filter (where gi.status in ('complete','failed','skipped')) as terminal_count
  from public.generation_batches gb
  left join public.generation_items gi on gi.batch_id = gb.id
  group by gb.id
),
library_rollups as (
  select
    gb.id,
    greatest(1, least(coalesce(gb.quantity, gb.post_count, 1), 250)) as requested_quantity,
    count(vli.id) as slot_count,
    count(vli.id) filter (where vli.status in ('ready','scheduled','posted')) as ready_count,
    count(vli.id) filter (where vli.status in ('failed','blocked')) as failed_count
  from public.generation_batches gb
  left join public.video_library_items vli on vli.batch_id = gb.id
  group by gb.id, gb.quantity, gb.post_count
),
next_rollups as (
  select
    gb.id,
    case
      when gr.item_count = 0 then gb.status
      when gr.complete_count = gr.item_count then 'complete'
      when gr.failed_count = gr.item_count then 'failed'
      when gr.terminal_count = gr.item_count then 'partial'
      else 'generating'
    end as next_status,
    case
      when lr.slot_count = 0 and gb.audio_clip_id is null then gb.library_status
      when lr.slot_count < lr.requested_quantity then 'building'
      when lr.ready_count = lr.slot_count and lr.slot_count > 0 then 'ready'
      when lr.failed_count = lr.slot_count and lr.slot_count > 0 then 'failed'
      when lr.ready_count + lr.failed_count = lr.slot_count and lr.slot_count > 0 then 'exhausted'
      else 'building'
    end as next_library_status
  from public.generation_batches gb
  join generation_rollups gr on gr.id = gb.id
  join library_rollups lr on lr.id = gb.id
)
update public.generation_batches gb
set
  status = nr.next_status,
  library_status = nr.next_library_status,
  completed_at = case
    when nr.next_status in ('complete','failed','partial')
      then coalesce(gb.completed_at, now())
    else null
  end,
  started_at = case
    when nr.next_status = 'generating'
      then coalesce(gb.started_at, now())
    else gb.started_at
  end,
  error_message = case
    when nr.next_status = 'generating' then null
    else gb.error_message
  end,
  updated_at = now()
from next_rollups nr
where gb.id = nr.id
  and (
    gb.status is distinct from nr.next_status
    or gb.library_status is distinct from nr.next_library_status
    or (nr.next_status = 'generating' and gb.completed_at is not null)
  );
