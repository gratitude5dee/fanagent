-- FanAgent v2 library schema.
-- Adds the audio clip, finalized library, source candidate, render attempt,
-- and scheduling preset surfaces required by AGENTS.md Phase 1.

create table if not exists public.audio_clips (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  source_asset_id uuid not null references public.media_assets(id) on delete restrict,
  trimmed_asset_id uuid references public.media_assets(id) on delete set null,
  selection_start_sec numeric not null,
  selection_end_sec numeric not null,
  duration_sec int not null check (duration_sec in (15,30,45,60,75,90)),
  file_name text,
  perceptual_hash text,
  transcription_status text not null default 'pending'
    check (transcription_status in ('pending','running','ready','failed','manual')),
  default_lyric_template_id uuid references public.kanvas_lyric_templates(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_audio_clips_account
  on public.audio_clips(account_id, created_at desc);

create table if not exists public.video_library_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  audio_clip_id uuid not null references public.audio_clips(id) on delete cascade,
  batch_id uuid references public.generation_batches(id) on delete set null,
  generation_item_id uuid references public.generation_items(id) on delete set null,
  library_index int not null,
  status text not null default 'not_ready'
    check (status in ('not_ready','ready','scheduled','posted','blocked','failed','archived')),
  final_asset_id uuid references public.media_assets(id) on delete set null,
  thumbnail_url text,
  duration_sec int not null,
  segments jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '[]'::jsonb,
  perceptual_hash text,
  reused_flags jsonb not null default '{}'::jsonb,
  default_caption text,
  default_hashtags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (audio_clip_id, library_index)
);

create index if not exists idx_video_library_items_account_status
  on public.video_library_items(account_id, status, created_at desc);

create index if not exists idx_video_library_items_audio_clip
  on public.video_library_items(audio_clip_id, library_index);

create table if not exists public.source_candidates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  source_type text not null
    check (source_type in ('stock','library','seedance','gmi_seedance','sports_edit','streamer_clip')),
  provider text not null,
  external_id text,
  origin_url text not null,
  cached_url text,
  storage_bucket text,
  storage_path text,
  width int,
  height int,
  duration_seconds numeric not null,
  is_portrait boolean not null default false,
  perceptual_hash text,
  license text not null default 'unknown',
  rights_holder text,
  attribution text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (source_type, provider, external_id)
);

create index if not exists idx_source_candidates_search
  on public.source_candidates(source_type, provider, is_portrait, duration_seconds);

create index if not exists idx_source_candidates_phash
  on public.source_candidates(perceptual_hash);

create table if not exists public.source_candidate_uses (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.source_candidates(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  audio_clip_id uuid references public.audio_clips(id) on delete cascade,
  batch_id uuid references public.generation_batches(id) on delete cascade,
  generation_item_id uuid not null references public.generation_items(id) on delete cascade,
  segment_index int not null,
  reused boolean not null default false,
  tolerance_seconds_used int,
  created_at timestamptz default now(),
  unique (generation_item_id, segment_index)
);

create index if not exists idx_source_candidate_uses_batch
  on public.source_candidate_uses(batch_id);

create index if not exists idx_source_candidate_uses_audio_clip
  on public.source_candidate_uses(audio_clip_id);

create table if not exists public.render_attempts (
  id uuid primary key default gen_random_uuid(),
  generation_item_id uuid not null references public.generation_items(id) on delete cascade,
  stage text not null check (stage in ('sourcing','stitch','karaoke','thumbnail','finalize')),
  status text not null check (status in ('started','succeeded','failed')),
  provider text,
  request_id text,
  error text,
  detail jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists idx_render_attempts_item
  on public.render_attempts(generation_item_id, started_at desc);

create table if not exists public.post_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  rule jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.generation_batches
  add column if not exists audio_clip_id uuid references public.audio_clips(id) on delete set null,
  add column if not exists quantity int not null default 1,
  add column if not exists dedupe_strategy text not null default 'strict',
  add column if not exists duration_tolerance_seconds int not null default 5,
  add column if not exists duration_tolerance_fallback_seconds int not null default 10,
  add column if not exists library_status text not null default 'building';

alter table public.generation_items
  add column if not exists library_item_id uuid references public.video_library_items(id) on delete set null,
  add column if not exists audio_clip_id uuid references public.audio_clips(id) on delete set null,
  add column if not exists duration_tolerance_seconds_used int,
  add column if not exists perceptual_hash text;

alter table public.posts
  add column if not exists library_item_id uuid references public.video_library_items(id) on delete set null,
  add column if not exists privacy_settings jsonb not null default '{}'::jsonb;

comment on column public.media_assets.metadata is
  'For generated_video and rendered_video assets, metadata.perceptual_hash is pHash64. metadata.thumbnail_url is the post-thumbnail keyframe URL when available.';

update public.generation_batches
set
  source_mode = case
    when source_mode = 'hybrid' then 'mixed'
    when source_mode = 'remote_render' then 'stock'
    else source_mode
  end,
  quantity = greatest(1, least(coalesce(post_count, quantity), 250)),
  cadence_minutes = greatest(5, least(coalesce(cadence_minutes, 240), 10080)),
  updated_at = now()
where source_mode in ('hybrid', 'remote_render')
  or quantity is distinct from greatest(1, least(coalesce(post_count, quantity), 250))
  or cadence_minutes is distinct from greatest(5, least(coalesce(cadence_minutes, 240), 10080));

update public.posts
set publish_status = case
  when publish_status = 'PUBLISH_COMPLETE' then 'publish_complete'
  when publish_status = 'PROCESSING_UPLOAD' then 'processing'
  when publish_status = 'PROCESSING_DOWNLOAD' then 'processing'
  when publish_status = 'PROCESSING' then 'processing'
  when publish_status = 'FAILED' then 'failed'
  when publish_status = 'regenerated' then null
  else publish_status
end
where publish_status in (
  'PUBLISH_COMPLETE',
  'PROCESSING_UPLOAD',
  'PROCESSING_DOWNLOAD',
  'PROCESSING',
  'FAILED',
  'regenerated'
);

alter table public.generation_batches
  drop constraint if exists valid_generation_batch_source;

alter table public.generation_batches
  add constraint valid_generation_batch_source
  check (source_mode in ('stock','mixed','seedance','gmi_seedance','sports_edit','streamer_clip'));

alter table public.generation_batches
  drop constraint if exists generation_batches_quantity_check;

alter table public.generation_batches
  add constraint generation_batches_quantity_check
  check (quantity >= 1 and quantity <= 250);

alter table public.generation_batches
  drop constraint if exists generation_batches_cadence_minutes_check;

alter table public.generation_batches
  add constraint generation_batches_cadence_minutes_check
  check (cadence_minutes between 5 and 10080);

alter table public.generation_batches
  drop constraint if exists generation_batches_dedupe_strategy_check;

alter table public.generation_batches
  add constraint generation_batches_dedupe_strategy_check
  check (dedupe_strategy in ('strict','allow_reuse_after_exhaustion','allow_reuse_freely'));

alter table public.generation_batches
  drop constraint if exists generation_batches_library_status_check;

alter table public.generation_batches
  add constraint generation_batches_library_status_check
  check (library_status in ('building','ready','exhausted','failed'));

alter table public.generation_items
  drop constraint if exists valid_generation_item_status;

alter table public.generation_items
  add constraint valid_generation_item_status
  check (
    status in (
      'pending',
      'planning',
      'transcribing',
      'sourcing',
      'picking_stock',
      'generating',
      'rendering',
      'stitched',
      'ready',
      'complete',
      'failed',
      'skipped'
    )
  );

alter table public.posts
  drop constraint if exists posts_publish_status_check;

alter table public.posts
  add constraint posts_publish_status_check
  check (
    publish_status is null or publish_status in (
      'ready',
      'initializing',
      'uploading',
      'processing',
      'publish_complete',
      'failed',
      'retry_scheduled',
      'blocked_account_not_connected',
      'blocked_missing_privacy',
      'blocked_creator_restriction',
      'blocked_missing_video'
    )
  );

alter table public.posts
  drop constraint if exists posts_scheduled_at_sanity_check;

alter table public.posts
  add constraint posts_scheduled_at_sanity_check
  check (scheduled_at >= '2024-01-01'::timestamptz);

with source_batches as (
  select
    gb.id,
    gb.account_id,
    gb.audio_asset_id,
    coalesce(ma.file_name, 'backfilled-audio-clip') as file_name,
    case
      when coalesce(gb.duration_seconds, 15)::int in (15,30,45,60,75,90)
        then coalesce(gb.duration_seconds, 15)::int
      else 15
    end as duration_sec
  from public.generation_batches gb
  left join public.media_assets ma on ma.id = gb.audio_asset_id
  where gb.audio_clip_id is null
    and gb.account_id is not null
    and gb.audio_asset_id is not null
),
inserted as (
  insert into public.audio_clips (
    account_id,
    source_asset_id,
    selection_start_sec,
    selection_end_sec,
    duration_sec,
    file_name,
    transcription_status,
    metadata
  )
  select
    account_id,
    audio_asset_id,
    0,
    duration_sec,
    duration_sec,
    file_name,
    'pending',
    jsonb_build_object('backfill_batch_id', id)
  from source_batches
  returning id, metadata
)
update public.generation_batches gb
set audio_clip_id = inserted.id,
    updated_at = now()
from inserted
where gb.id = (inserted.metadata->>'backfill_batch_id')::uuid
  and gb.audio_clip_id is null;

update public.generation_items gi
set audio_clip_id = gb.audio_clip_id,
    updated_at = now()
from public.generation_batches gb
where gi.batch_id = gb.id
  and gi.audio_clip_id is null
  and gb.audio_clip_id is not null;

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
  gi.account_id,
  gi.audio_clip_id,
  gi.batch_id,
  gi.id,
  gi.item_index,
  'ready',
  gi.final_asset_id,
  coalesce(ma.metadata->>'thumbnail_url', ma.public_url),
  case
    when coalesce(gi.duration_seconds, 15)::int in (15,30,45,60,75,90)
      then coalesce(gi.duration_seconds, 15)::int
    else 15
  end,
  coalesce(gi.segments, '[]'::jsonb),
  case
    when gi.stock_clip_url is not null
      then jsonb_build_array(jsonb_build_object('source_type', 'stock', 'origin_url', gi.stock_clip_url))
    else '[]'::jsonb
  end,
  coalesce(gi.perceptual_hash, ma.metadata->>'perceptual_hash'),
  p.caption,
  coalesce(p.hashtags, '{}'::text[]),
  jsonb_build_object('backfilled_from_generation_item', gi.id)
from public.generation_items gi
left join public.media_assets ma on ma.id = gi.final_asset_id
left join lateral (
  select caption, hashtags
  from public.posts p
  where p.generation_item_id = gi.id
  order by p.created_at desc
  limit 1
) p on true
where gi.final_asset_id is not null
  and gi.account_id is not null
  and gi.audio_clip_id is not null
on conflict (audio_clip_id, library_index) do update
set
  generation_item_id = excluded.generation_item_id,
  final_asset_id = excluded.final_asset_id,
  thumbnail_url = excluded.thumbnail_url,
  duration_sec = excluded.duration_sec,
  segments = excluded.segments,
  provenance = excluded.provenance,
  perceptual_hash = excluded.perceptual_hash,
  default_caption = excluded.default_caption,
  default_hashtags = excluded.default_hashtags,
  status = 'ready',
  updated_at = now();

update public.generation_items gi
set library_item_id = vli.id,
    updated_at = now()
from public.video_library_items vli
where vli.generation_item_id = gi.id
  and gi.library_item_id is null;

update public.posts p
set library_item_id = vli.id
from public.video_library_items vli
where p.generation_item_id = vli.generation_item_id
  and p.library_item_id is null;

insert into storage.buckets (id, name, public, file_size_limit)
values ('thumbnails', 'thumbnails', true, 5 * 1024 * 1024)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

alter table public.audio_clips enable row level security;
alter table public.video_library_items enable row level security;
alter table public.source_candidates enable row level security;
alter table public.source_candidate_uses enable row level security;
alter table public.render_attempts enable row level security;
alter table public.post_schedule_slots enable row level security;

drop policy if exists "FanAgent dashboard read audio clips" on public.audio_clips;
create policy "FanAgent dashboard read audio clips"
  on public.audio_clips for select
  to anon, authenticated
  using (true);

drop policy if exists "FanAgent dashboard read video library items" on public.video_library_items;
create policy "FanAgent dashboard read video library items"
  on public.video_library_items for select
  to anon, authenticated
  using (true);

drop policy if exists "FanAgent dashboard read source candidates" on public.source_candidates;
create policy "FanAgent dashboard read source candidates"
  on public.source_candidates for select
  to anon, authenticated
  using (true);

drop policy if exists "FanAgent dashboard read source candidate uses" on public.source_candidate_uses;
create policy "FanAgent dashboard read source candidate uses"
  on public.source_candidate_uses for select
  to anon, authenticated
  using (true);

drop policy if exists "FanAgent dashboard read render attempts" on public.render_attempts;
create policy "FanAgent dashboard read render attempts"
  on public.render_attempts for select
  to anon, authenticated
  using (true);

drop policy if exists "FanAgent dashboard read schedule slots" on public.post_schedule_slots;
create policy "FanAgent dashboard read schedule slots"
  on public.post_schedule_slots for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read thumbnails" on storage.objects;
create policy "Public read thumbnails"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'thumbnails');
