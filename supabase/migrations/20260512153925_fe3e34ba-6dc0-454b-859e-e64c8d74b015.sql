-- Lyrics Template Builder schema
create table if not exists public.project_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('audio','audio_trimmed')),
  storage_bucket text not null default 'audio-uploads',
  storage_path text not null,
  public_url text,
  file_name text,
  mime_type text,
  byte_size bigint,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.project_assets enable row level security;
create policy "project_assets owner select" on public.project_assets for select using (auth.uid() = user_id);
create policy "project_assets owner insert" on public.project_assets for insert with check (auth.uid() = user_id);
create policy "project_assets owner update" on public.project_assets for update using (auth.uid() = user_id);
create policy "project_assets owner delete" on public.project_assets for delete using (auth.uid() = user_id);
create index if not exists project_assets_user_idx on public.project_assets(user_id, created_at desc);

create table if not exists public.kanvas_lyric_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'Untitled template',
  status text not null default 'draft' check (status in ('draft','audio_ready','lyrics_processing','lyrics_ready','markers_ready','saved','failed','archived')),
  source_audio_asset_id uuid references public.project_assets(id) on delete set null,
  trimmed_audio_asset_id uuid references public.project_assets(id) on delete set null,
  selection_start_ms integer not null default 0,
  selection_duration_ms integer not null default 15000,
  total_duration_ms integer not null default 0,
  waveform_peaks jsonb not null default '[]'::jsonb,
  lyric_blocks jsonb not null default '[]'::jsonb,
  cut_markers jsonb not null default '[]'::jsonb,
  transcript_meta jsonb not null default '{}'::jsonb,
  render_defaults jsonb not null default '{}'::jsonb,
  error_message text,
  saved_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.kanvas_lyric_templates enable row level security;
create policy "lyric_templates owner select" on public.kanvas_lyric_templates for select using (auth.uid() = user_id);
create policy "lyric_templates owner insert" on public.kanvas_lyric_templates for insert with check (auth.uid() = user_id);
create policy "lyric_templates owner update" on public.kanvas_lyric_templates for update using (auth.uid() = user_id);
create policy "lyric_templates owner delete" on public.kanvas_lyric_templates for delete using (auth.uid() = user_id);
create index if not exists lyric_templates_user_idx on public.kanvas_lyric_templates(user_id, updated_at desc);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists kanvas_lyric_templates_touch on public.kanvas_lyric_templates;
create trigger kanvas_lyric_templates_touch before update on public.kanvas_lyric_templates
  for each row execute function public.touch_updated_at();

create table if not exists public.kanvas_lyric_template_jobs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.kanvas_lyric_templates(id) on delete cascade,
  user_id uuid not null,
  kind text not null default 'transcribe',
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed')),
  provider text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  response jsonb,
  created_at timestamptz not null default now()
);
alter table public.kanvas_lyric_template_jobs enable row level security;
create policy "lyric_jobs owner select" on public.kanvas_lyric_template_jobs for select using (auth.uid() = user_id);
create policy "lyric_jobs owner insert" on public.kanvas_lyric_template_jobs for insert with check (auth.uid() = user_id);
create policy "lyric_jobs owner update" on public.kanvas_lyric_template_jobs for update using (auth.uid() = user_id);
create index if not exists lyric_jobs_template_idx on public.kanvas_lyric_template_jobs(template_id, created_at desc);
