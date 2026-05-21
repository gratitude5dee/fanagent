-- Repair FanAgent library/generation links so failed library slots can be
-- regenerated even when the initial render failed before library-finalize ran.

update public.video_library_items vli
set generation_item_id = gi.id,
    updated_at = now()
from public.generation_items gi
where vli.generation_item_id is null
  and gi.library_item_id = vli.id;

update public.generation_items gi
set library_item_id = vli.id,
    updated_at = now()
from public.video_library_items vli
where gi.library_item_id is null
  and vli.generation_item_id = gi.id;

with slot_matches as (
  select
    vli.id as library_item_id,
    gi.id as generation_item_id
  from public.video_library_items vli
  join public.generation_items gi
    on gi.batch_id = vli.batch_id
   and gi.item_index = vli.library_index
   and gi.audio_clip_id = vli.audio_clip_id
  where vli.generation_item_id is null
    and vli.batch_id is not null
    and gi.library_item_id is null
)
update public.video_library_items vli
set generation_item_id = slot_matches.generation_item_id,
    updated_at = now()
from slot_matches
where vli.id = slot_matches.library_item_id
  and vli.generation_item_id is null;

update public.generation_items gi
set library_item_id = vli.id,
    updated_at = now()
from public.video_library_items vli
where gi.library_item_id is null
  and vli.generation_item_id = gi.id;

create index if not exists idx_video_library_items_generation_item_id
  on public.video_library_items(generation_item_id)
  where generation_item_id is not null;

create index if not exists idx_generation_items_library_item_id
  on public.generation_items(library_item_id)
  where library_item_id is not null;

create index if not exists idx_video_library_items_failed_regenerate
  on public.video_library_items(account_id, updated_at desc)
  where status in ('failed', 'blocked', 'not_ready');
