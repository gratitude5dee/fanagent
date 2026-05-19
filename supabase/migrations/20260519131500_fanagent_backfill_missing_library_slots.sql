-- Backfill finalized-library slots for legacy generation items that existed
-- before video_library_items were materialized for every requested quantity.

update public.generation_items gi
set audio_clip_id = gb.audio_clip_id,
    updated_at = now()
from public.generation_batches gb
where gi.batch_id = gb.id
  and gi.audio_clip_id is null
  and gb.audio_clip_id is not null;

with source_items as (
  select
    gi.id as generation_item_id,
    gi.account_id,
    gi.audio_clip_id,
    gi.batch_id,
    gi.item_index as library_index,
    gi.status as generation_status,
    gi.final_asset_id,
    gi.stock_clip_url,
    gi.duration_seconds,
    gi.segments,
    gi.perceptual_hash,
    coalesce(ma.metadata->>'thumbnail_url', ma.public_url) as thumbnail_url,
    coalesce(ma.metadata->>'perceptual_hash', gi.perceptual_hash) as asset_perceptual_hash,
    p.id as post_id,
    p.status as post_status,
    p.caption,
    p.hashtags
  from public.generation_items gi
  left join public.media_assets ma on ma.id = gi.final_asset_id
  left join lateral (
    select id, status, caption, hashtags
    from public.posts p
    where p.generation_item_id = gi.id
    order by p.created_at desc
    limit 1
  ) p on true
  where gi.library_item_id is null
    and gi.account_id is not null
    and gi.audio_clip_id is not null
),
inserted_slots as (
  insert into public.video_library_items (
    account_id,
    audio_clip_id,
    batch_id,
    generation_item_id,
    library_index,
    status,
    final_asset_id,
    thumbnail_url,
    duration_sec,
    segments,
    provenance,
    perceptual_hash,
    default_caption,
    default_hashtags,
    metadata
  )
  select
    account_id,
    audio_clip_id,
    batch_id,
    generation_item_id,
    library_index,
    case
      when post_status = 'posted' then 'posted'
      when post_id is not null and final_asset_id is not null then 'scheduled'
      when final_asset_id is not null then 'ready'
      when generation_status = 'failed' then 'failed'
      when generation_status = 'skipped' then 'blocked'
      else 'not_ready'
    end,
    final_asset_id,
    thumbnail_url,
    case
      when coalesce(duration_seconds, 15)::int in (15,30,45,60,75,90)
        then coalesce(duration_seconds, 15)::int
      else 15
    end,
    coalesce(segments, '[]'::jsonb),
    case
      when stock_clip_url is not null
        then jsonb_build_array(jsonb_build_object('source_type', 'stock', 'origin_url', stock_clip_url))
      else '[]'::jsonb
    end,
    coalesce(perceptual_hash, asset_perceptual_hash),
    caption,
    coalesce(hashtags, '{}'::text[]),
    jsonb_build_object(
      'backfilled_from_generation_item',
      generation_item_id,
      'backfilled_missing_library_slot',
      true
    )
  from source_items
  on conflict (audio_clip_id, library_index) do update
  set
    batch_id = coalesce(public.video_library_items.batch_id, excluded.batch_id),
    generation_item_id = coalesce(public.video_library_items.generation_item_id, excluded.generation_item_id),
    status = case
      when public.video_library_items.status in ('ready','scheduled','posted')
        and excluded.status = 'not_ready'
        then public.video_library_items.status
      else excluded.status
    end,
    final_asset_id = coalesce(excluded.final_asset_id, public.video_library_items.final_asset_id),
    thumbnail_url = coalesce(excluded.thumbnail_url, public.video_library_items.thumbnail_url),
    duration_sec = excluded.duration_sec,
    segments = case
      when jsonb_array_length(excluded.segments) > 0 then excluded.segments
      else public.video_library_items.segments
    end,
    provenance = case
      when jsonb_array_length(excluded.provenance) > 0 then excluded.provenance
      else public.video_library_items.provenance
    end,
    perceptual_hash = coalesce(excluded.perceptual_hash, public.video_library_items.perceptual_hash),
    default_caption = coalesce(excluded.default_caption, public.video_library_items.default_caption),
    default_hashtags = case
      when cardinality(excluded.default_hashtags) > 0 then excluded.default_hashtags
      else public.video_library_items.default_hashtags
    end,
    metadata = coalesce(public.video_library_items.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now()
  where public.video_library_items.generation_item_id is null
     or public.video_library_items.generation_item_id = excluded.generation_item_id
  returning id, generation_item_id
)
update public.generation_items gi
set library_item_id = inserted_slots.id,
    updated_at = now()
from inserted_slots
where gi.id = inserted_slots.generation_item_id
  and gi.library_item_id is null;

update public.generation_items gi
set library_item_id = vli.id,
    updated_at = now()
from public.video_library_items vli
where gi.library_item_id is null
  and vli.generation_item_id = gi.id;

with batch_rollups as (
  select
    gb.id,
    greatest(1, least(coalesce(gb.quantity, gb.post_count, 1), 250)) as requested_quantity,
    count(vli.id) as slot_count,
    count(vli.id) filter (where vli.status in ('ready','scheduled','posted')) as ready_count,
    count(vli.id) filter (where vli.status in ('failed','blocked')) as failed_count
  from public.generation_batches gb
  left join public.video_library_items vli on vli.batch_id = gb.id
  where gb.audio_clip_id is not null
  group by gb.id, gb.quantity, gb.post_count
)
update public.generation_batches gb
set library_status = case
      when br.slot_count < br.requested_quantity then 'building'
      when br.ready_count = br.slot_count and br.slot_count > 0 then 'ready'
      when br.failed_count = br.slot_count and br.slot_count > 0 then 'failed'
      when br.ready_count + br.failed_count = br.slot_count and br.slot_count > 0 then 'exhausted'
      else 'building'
    end,
    updated_at = now()
from batch_rollups br
where gb.id = br.id;
