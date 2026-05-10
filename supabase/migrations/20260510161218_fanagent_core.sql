create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

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
  created_at timestamptz default now()
);

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
  created_at timestamptz default now(),
  constraint valid_media_asset_kind check (
    kind in ('audio','source_video','generated_video','rendered_video','thumbnail','other')
  )
);

create table if not exists public.generation_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  audio_asset_id uuid references public.media_assets(id) on delete set null,
  source_mode text not null default 'gmi_seedance',
  prompt text,
  post_count int not null,
  cadence_minutes int not null default 240,
  timezone text not null default 'America/Los_Angeles',
  status text not null default 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint valid_generation_batch_source check (
    source_mode in ('gmi_seedance','remote_render')
  ),
  constraint valid_generation_batch_status check (
    status in ('pending','generating','complete','failed','partial')
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
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint valid_generation_item_status check (
    status in ('pending','generating','rendering','complete','failed')
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
  video_source text default 'gmi_seedance',
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

alter table public.generation_items
  add constraint generation_items_post_id_fkey
  foreign key (post_id) references public.posts(id) on delete set null;

create table if not exists public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id),
  account_id uuid references public.accounts(id),
  action text not null,
  detail jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_posts_status_scheduled
  on public.posts(status, scheduled_at);

create index if not exists idx_generation_items_status_created
  on public.generation_items(status, created_at);

create index if not exists idx_generation_items_account_status
  on public.generation_items(account_id, status);

create index if not exists idx_posts_tiktok_publish_status
  on public.posts(platform, status, publish_status, scheduled_at);

insert into storage.buckets (id, name, public)
values ('post-assets', 'post-assets', true)
on conflict (id) do update set public = excluded.public;

insert into public.accounts (platform, handle, status)
select 'tiktok', 'fanagent', 'active'
where not exists (
  select 1 from public.accounts where platform = 'tiktok'
);

alter table public.artists enable row level security;
alter table public.accounts enable row level security;
alter table public.media_assets enable row level security;
alter table public.generation_batches enable row level security;
alter table public.generation_items enable row level security;
alter table public.posts enable row level security;
alter table public.agent_logs enable row level security;

drop policy if exists "FanAgent dashboard read artists" on public.artists;
create policy "FanAgent dashboard read artists"
  on public.artists for select
  to anon, authenticated
  using (true);

drop policy if exists "FanAgent dashboard read accounts" on public.accounts;
create policy "FanAgent dashboard read accounts"
  on public.accounts for select
  to anon, authenticated
  using (true);

drop policy if exists "FanAgent dashboard read media assets" on public.media_assets;
create policy "FanAgent dashboard read media assets"
  on public.media_assets for select
  to anon, authenticated
  using (true);

drop policy if exists "FanAgent dashboard read batches" on public.generation_batches;
create policy "FanAgent dashboard read batches"
  on public.generation_batches for select
  to anon, authenticated
  using (true);

drop policy if exists "FanAgent dashboard read items" on public.generation_items;
create policy "FanAgent dashboard read items"
  on public.generation_items for select
  to anon, authenticated
  using (true);

drop policy if exists "FanAgent dashboard read posts" on public.posts;
create policy "FanAgent dashboard read posts"
  on public.posts for select
  to anon, authenticated
  using (true);

drop policy if exists "FanAgent dashboard read logs" on public.agent_logs;
create policy "FanAgent dashboard read logs"
  on public.agent_logs for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read post assets" on storage.objects;
create policy "Public read post assets"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'post-assets');

-- Supabase Cron setup after deploying functions and setting Vault secrets:
-- select vault.create_secret('https://zjbiulirzrctfmakqjwk.supabase.co', 'fanagent_project_url');
-- select vault.create_secret('<anon-key>', 'fanagent_anon_key');
-- select cron.schedule(
--   'fanagent-process-generation-due',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'fanagent_project_url') || '/functions/v1/process-generation-due',
--     headers := jsonb_build_object('Content-type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'fanagent_anon_key')),
--     body := '{}'::jsonb
--   );
--   $$
-- );
-- select cron.schedule(
--   'fanagent-publish-tiktok-due',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'fanagent_project_url') || '/functions/v1/publish-tiktok-due',
--     headers := jsonb_build_object('Content-type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'fanagent_anon_key')),
--     body := '{}'::jsonb
--   );
--   $$
-- );
