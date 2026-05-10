create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============ CORE TABLES ============

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  profile jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid references public.artists(id) on delete cascade,
  platform text not null default 'tiktok',
  handle text,
  status text default 'active',
  tiktok_open_id text,
  tiktok_display_name text,
  tiktok_access_token_encrypted text,
  tiktok_refresh_token_encrypted text,
  tiktok_token_expires_at timestamptz,
  tiktok_scope text,
  tiktok_connected_at timestamptz,
  tiktok_creator_info jsonb,
  is_primary boolean not null default false,
  created_at timestamptz default now()
);

create unique index if not exists idx_accounts_one_primary_per_artist
  on public.accounts(artist_id, platform)
  where is_primary;

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete set null,
  kind text not null,
  source text not null,
  storage_bucket text not null default 'post-assets',
  storage_path text,
  public_url text not null,
  mime_type text,
  file_name text,
  byte_size bigint,
  duration_seconds numeric,
  metadata jsonb not null default '{}',
  transcript jsonb,
  created_at timestamptz default now(),
  constraint valid_media_asset_kind check (
    kind in ('audio','source_video','generated_video','rendered_video','thumbnail','stock_video','other')
  )
);

create table if not exists public.generation_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  audio_asset_id uuid references public.media_assets(id) on delete set null,
  source_mode text not null default 'stock',
  prompt text,
  post_count int not null,
  cadence_minutes int not null default 1440,
  next_run_at timestamptz,
  paused_at timestamptz,
  timezone text not null default 'America/Los_Angeles',
  status text not null default 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint valid_generation_batch_source check (
    source_mode in ('gmi_seedance','remote_render','stock','seedance','hybrid')
  ),
  constraint valid_generation_batch_status check (
    status in ('pending','generating','complete','failed','partial','paused')
  )
);

create table if not exists public.generation_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.generation_batches(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  item_index int not null,
  status text not null default 'pending',
  provider text not null,
  model_id text,
  prompt text not null,
  input_payload jsonb not null default '{}',
  provider_request_id text,
  generated_asset_id uuid references public.media_assets(id) on delete set null,
  final_asset_id uuid references public.media_assets(id) on delete set null,
  post_id uuid,
  scheduled_at timestamptz not null,
  estimated_cost_cents int,
  duration_seconds int not null default 15,
  stock_clip_url text,
  render_provider text,
  render_job_id text,
  render_callback_token text,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint valid_generation_item_status check (
    status in ('pending','transcribing','picking_stock','generating','rendering','ready','complete','failed')
  ),
  constraint generation_items_batch_index_unique unique (batch_id, item_index)
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  artist_id uuid references public.artists(id),
  platform text not null default 'tiktok',
  post_type text not null default 'video',
  video_url text,
  video_source text default 'stock',
  audio_url text,
  caption text not null,
  hashtags text[] not null default '{}',
  hook_text text,
  scheduled_at timestamptz not null,
  posted_at timestamptz,
  status text not null default 'pending',
  retry_count int default 0,
  error_message text,
  views int,
  likes int,
  batch_id uuid references public.generation_batches(id) on delete set null,
  generation_item_id uuid references public.generation_items(id) on delete set null,
  final_asset_id uuid references public.media_assets(id) on delete set null,
  tiktok_publish_id text,
  tiktok_post_id text,
  publish_status text,
  publish_error text,
  tiktok_privacy_level text,
  tiktok_disable_duet boolean not null default true,
  tiktok_disable_stitch boolean not null default true,
  tiktok_disable_comment boolean not null default false,
  tiktok_is_aigc boolean not null default true,
  tiktok_brand_content boolean not null default false,
  tiktok_brand_organic boolean not null default false,
  created_at timestamptz default now(),
  constraint valid_post_status check (
    status in ('pending','posting','posted','failed','skipped')
  ),
  constraint valid_post_type check (
    post_type in ('video','text')
  )
);

do $$ begin
  alter table public.generation_items
    add constraint generation_items_post_id_fkey
    foreign key (post_id) references public.posts(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id),
  account_id uuid references public.accounts(id),
  action text not null,
  detail jsonb,
  created_at timestamptz default now()
);

-- ============ AUTOPILOT NEW TABLES ============

create table if not exists public.publish_attempts (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade,
  tiktok_publish_id text,
  status text not null,
  error text,
  raw_response jsonb,
  attempted_at timestamptz default now()
);

create index if not exists idx_publish_attempts_post on public.publish_attempts(post_id, attempted_at desc);

create table if not exists public.worker_runs (
  id uuid primary key default gen_random_uuid(),
  function_name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  items_processed int default 0,
  errors_count int default 0,
  detail jsonb
);

create index if not exists idx_worker_runs_recent on public.worker_runs(function_name, started_at desc);

-- ============ INDEXES ============

create index if not exists idx_posts_status_scheduled on public.posts(status, scheduled_at);
create index if not exists idx_generation_items_status_created on public.generation_items(status, created_at);
create index if not exists idx_generation_items_account_status on public.generation_items(account_id, status);
create index if not exists idx_generation_items_render_job on public.generation_items(render_job_id);
create index if not exists idx_posts_tiktok_publish_status on public.posts(platform, status, publish_status, scheduled_at);

-- ============ STORAGE BUCKETS ============

insert into storage.buckets (id, name, public)
values
  ('post-assets', 'post-assets', true),
  ('audio-uploads', 'audio-uploads', false),
  ('stock-cache', 'stock-cache', false),
  ('renders', 'renders', false)
on conflict (id) do nothing;

-- ============ SEED DEFAULT ACCOUNT ============

insert into public.accounts (platform, handle, status, is_primary)
select 'tiktok', 'fanagent', 'active', true
where not exists (
  select 1 from public.accounts where platform = 'tiktok'
);

-- ============ RLS ============

alter table public.artists enable row level security;
alter table public.accounts enable row level security;
alter table public.media_assets enable row level security;
alter table public.generation_batches enable row level security;
alter table public.generation_items enable row level security;
alter table public.posts enable row level security;
alter table public.agent_logs enable row level security;
alter table public.publish_attempts enable row level security;
alter table public.worker_runs enable row level security;

drop policy if exists "FanAgent dashboard read artists" on public.artists;
create policy "FanAgent dashboard read artists" on public.artists for select to anon, authenticated using (true);

drop policy if exists "FanAgent dashboard read accounts" on public.accounts;
create policy "FanAgent dashboard read accounts" on public.accounts for select to anon, authenticated using (true);

drop policy if exists "FanAgent dashboard read media assets" on public.media_assets;
create policy "FanAgent dashboard read media assets" on public.media_assets for select to anon, authenticated using (true);

drop policy if exists "FanAgent dashboard read batches" on public.generation_batches;
create policy "FanAgent dashboard read batches" on public.generation_batches for select to anon, authenticated using (true);

drop policy if exists "FanAgent dashboard read items" on public.generation_items;
create policy "FanAgent dashboard read items" on public.generation_items for select to anon, authenticated using (true);

drop policy if exists "FanAgent dashboard read posts" on public.posts;
create policy "FanAgent dashboard read posts" on public.posts for select to anon, authenticated using (true);

drop policy if exists "FanAgent dashboard read logs" on public.agent_logs;
create policy "FanAgent dashboard read logs" on public.agent_logs for select to anon, authenticated using (true);

drop policy if exists "FanAgent dashboard read publish_attempts" on public.publish_attempts;
create policy "FanAgent dashboard read publish_attempts" on public.publish_attempts for select to anon, authenticated using (true);

drop policy if exists "FanAgent dashboard read worker_runs" on public.worker_runs;
create policy "FanAgent dashboard read worker_runs" on public.worker_runs for select to anon, authenticated using (true);

-- ============ STORAGE RLS ============

drop policy if exists "Public read post assets" on storage.objects;
create policy "Public read post assets"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'post-assets');