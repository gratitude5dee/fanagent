# FanAgent — Decision-Complete Implementation Spec

> Target repo: `https://github.com/gratitude5dee/fanagent` (committed to `main`).
> Implementation target: the working tree under `fanagent-main 2/` (Vite + React 19 + TypeScript, Supabase Postgres/Storage/Edge Functions/Cron, FullCalendar). Reference repos `AiToEarn-main/` and `social-media-scraping-apis-main/` are read-only inspiration for adapter shapes and feature ideas; no code is to be vendored from them.
>
> This document is the single source of truth for Codex. Codex MUST implement every section below verbatim. Where this spec names a table column, status string, action verb, JSON field, env var, route, or storage bucket, that name is normative. Where it disagrees with what currently exists in the repo, the spec wins and a migration/refactor is required.

---

## 1. Summary

FanAgent turns one short song clip into a calendar-scheduled, auto-published library of unique lyric videos. A user uploads audio, trims a single clip (15/30/45/60/75/90 seconds), edits the auto-generated lyric transcription template, sets a quantity (e.g. `20`), and then FanAgent sources or generates per-segment visuals from compliant providers (Pexels/Pixabay stock, user library, fal.ai Seedance 2, GMI Seedance, and pluggable sports-edit / streamer-clip adapters), filters them for vertical aspect + duration similarity (±5s preferred, ±10s fallback), deduplicates by provider + external id + URL + perceptual hash, stitches segments end-to-end with fal.ai ffmpeg-api, burns synced lyric subtitles from the editable template, stores durable MP4s in Supabase Storage, materializes a "finalized library for audio clip" of exactly the requested quantity, exposes that library through a FullCalendar UI that supports drag-to-reschedule and bulk scheduling, and auto-publishes due posts via the official TikTok Direct Post API. Publishing problems (TikTok not connected, missing privacy level, creator-info restrictions, provider 5xx) surface as actionable **blocked / retry** states on the post, never as generation failures.

**Already in the repo (must be preserved or refined, not rewritten):**

- Vite + React 19 + TS frontend with `/` (Autopilot + Studio), `/lyrics`, `/lyrics/new`, `/lyrics/templates/:id`.
- `AutopilotPanel.tsx` wizard with audio trim, duration buttons (15/30/45/60/75/90), source picker (`stock | mixed | seedance | gmi_seedance`), stock provider toggles, lyric template selector, TikTok privacy defaults, diagnostics panel.
- `AudioTrimmer.tsx` with WaveSurfer regions + Web Audio WAV export.
- `FanAgentCalendar.tsx` (FullCalendar dayGrid+timeGrid+interaction, drag-to-reschedule wired to `update-post-schedule`).
- `LyricsWizard.tsx` 3-step builder (Audio → Lyrics → Cut Markers) with `kanvas_lyric_templates` persistence.
- Edge functions: `create-generation-batch`, `fanpage-campaign`, `fanpage-generate-due`, `fanpage-publish-due`, `publish-tiktok-due`, `update-post-schedule`, `pick-stock-clip`, `generate-seedance-clip`, `stitch-segments`, `render-karaoke`, `transcribe-audio`, `kanvas-lyrics-template`, `kanvas-lyrics-transcribe`, `kanvas-lyrics-audio-register`, `generate-video-prompts`, `tiktok-oauth-callback`, `process-generation-due`, `render-callback`.
- Tables: `artists`, `accounts`, `media_assets`, `generation_batches`, `generation_items`, `posts`, `agent_logs`, `publish_attempts`, `worker_runs`, `project_assets`, `kanvas_lyric_templates`, `kanvas_lyric_template_jobs`.
- Storage buckets: `post-assets` (public), `audio-uploads`, `stock-cache`, `renders`.
- `claim_generation_items` SQL function with `FOR UPDATE SKIP LOCKED`, attempt counts, stage_events.
- TikTok OAuth + encrypted token storage (`TOKEN_ENCRYPTION_KEY`) and Direct Post (init → chunked upload → status poll).

**Must be added or refined:**

- A **finalized video library** abstraction (`video_library_items`) that is the user-facing artifact between generation and scheduling — currently the app conflates `generation_items` ⇄ `posts`.
- A **source candidate cache + dedupe ledger** (`source_candidates`, `source_candidate_uses`) that tracks every clip ever considered with provider, external id, url, perceptual hash, duration, aspect, license, and per-batch consumption — currently dedupe is implicit in `pick-stock-clip` only.
- New source adapters: **`sports_edit`** and **`streamer_clip`** (public/licensed only, e.g. Twitch Highlights via official Helix API and YouTube Data API for public sports-highlights channels the user owns or has rights to). Adapters live behind `_shared/sources/` with a uniform contract.
- Hard duration filtering: prefer `|clipDur - segDur| ≤ 5s`, fall back to `≤ 10s`, never exceed.
- A **template editing UI** that auto-opens after transcription and is required to leave the wizard.
- A **library view** with thumbnails, segment provenance, duration, dedupe markers, regenerate, and "Schedule on calendar" actions (single + bulk).
- A **calendar bulk scheduler** with cadence helpers (every N minutes/hours/days, time-of-day windows, randomized jitter).
- A **GenViral-shaped internal JSON contract** for every campaign / library / schedule / publish endpoint: `{ success, code, message, error, data }` with canonical `media` objects, accounts array, `scheduled_at`, and platform-specific TikTok options.
- A `posts.publish_status` enum that surfaces blocked states cleanly: `ready | initializing | uploading | processing | publish_complete | failed | retry_scheduled | blocked_account_not_connected | blocked_missing_privacy | blocked_creator_restriction | blocked_missing_video`.
- A new `posts.privacy_settings` JSON column to hold per-platform settings (TikTok today, future platforms) so the spec stays platform-agnostic.

The spec deliberately keeps the existing stack (Vite/React/TS, Supabase, FullCalendar) and the existing primary worker plumbing (`claim_generation_items` SQL + `fanpage-generate-due` + `fanpage-publish-due` with `x-cron-secret`).

---

## 2. User Experience

### 2.1 Routes

- `/` — Autopilot dashboard (default).
- `/library/:audioClipId` — Finalized Video Library view.
- `/calendar` — Full-width scheduling calendar with bulk tools (split out of `/`).
- `/lyrics`, `/lyrics/new`, `/lyrics/templates/:templateId` — Lyrics Template builder (existing).
- `/settings/accounts` — Accounts & TikTok OAuth status.

### 2.2 End-to-End Flow

1. **Land on `/`.** Header shows three tabs: **Create**, **Library**, **Calendar**.
2. **Create tab → 1. Connect TikTok.** Shows account status. If not connected, primary CTA opens `tiktok-oauth-callback?action=connect&accountId=…`. Disconnected state is non-blocking for generation but is shown as a **yellow banner**: "TikTok is not connected — videos will generate but auto-posting will pause until you reconnect."
3. **Create tab → 2. Upload Audio.** File input accepts MP3 / WAV / M4A / AAC / FLAC up to 50 MB. After file pick, `AudioTrimmer` renders the waveform. The user picks a single duration chip: `15 | 30 | 45 | 60 | 75 | 90` seconds. The trim region is hard-clamped to the chosen duration. "Confirm clip" exports a WAV blob and uploads it to `audio-uploads/<userId>/<assetId>.wav`.
4. **Create tab → 3. Lyric Template.**
   - Server auto-transcribes with ElevenLabs Scribe v2 (`transcribe-audio`).
   - On completion, the LyricsWizard opens inline (drawer) at step 2, pre-populated with detected words/blocks.
   - The user **must review** lyric blocks (rename labels, fix wrong words, drag word boundaries on the waveform), then click **Save Template**. The wizard auto-advances to step 3 (cut markers) which are optional but recommended for >15s clips.
   - The Save action sets `kanvas_lyric_templates.status = 'saved'` and selects that template on the campaign form.
   - **Empty state**: if transcription returns zero words, show "We couldn't detect lyrics in this clip — type them manually here, with optional timestamps." The user may proceed with manual lyric blocks.
5. **Create tab → 4. Campaign Parameters.**
   - Quantity (`postCount`): integer 1–250, default 20.
   - Source mode: radio of `stock | mixed | seedance | gmi_seedance | sports_edit | streamer_clip`. (Future adapters appear as additional radios sourced from `_shared/sources/registry.ts`.)
   - Per-source settings panel (keywords, mood, portraitOnly, avoidReuseWithinBatch, allowReuseWhenExhausted, Seedance resolution, sports league/team filter, streamer name allowlist).
   - Schedule first-post datetime + cadence minutes (5 ≤ cadence ≤ 10080). Cadence is a default — the user can also defer scheduling to step 6.
   - Visual theme / prompt (textarea, max 800 chars).
   - TikTok privacy default + interaction toggles (duet/stitch/comment) + AIGC label + brand-content flags (read from creator-info if connected).
   - Primary CTA: **Generate Library** → calls `fanpage-campaign` action `create` with the validated payload.
6. **Progress.** While the queue runs, the Create tab shows:
   - Per-item rows with status pills (`pending → planning → transcribing → picking_stock → generating → rendering → stitched → ready → complete`) and `stage_events` tail.
   - Live counts: planned / sourced / generated / stitched / ready / blocked.
   - Per-item provenance preview (provider, external id, reused flag).
   - "Pause batch" toggles `paused_at`.
7. **Library tab → `/library/:audioClipId`.** Reachable from the Create tab as soon as the first item reaches `ready`, and from the global Library tab once the batch completes. Renders the requested quantity (e.g. 20 tiles) of finalized lyric videos for that audio clip. Each tile shows:
   - 9:16 thumbnail (from `extract-frame` middle keyframe), MP4 length, segment count, source mode badge.
   - Provenance line: `pexels:1234567 + seedance + library:asset…`. Reused stock or fallback (`±10s`) clips are marked with an **amber chip**.
   - Hover/long-press to play the MP4 inline (uses durable Supabase Storage URLs from `renders` bucket).
   - Per-tile menu: **Schedule…**, **Regenerate**, **Replace one segment**, **Mark as unfit**, **Download MP4**, **Copy caption**.
   - Filters: show only `unscheduled`, `scheduled`, `posted`, `blocked`, `failed`; sort by created / next-scheduled / random.
   - Bulk-select bar with **Schedule selected on Calendar** + **Regenerate selected**.
8. **Calendar tab → `/calendar`.**
   - FullCalendar week view by default, with month + day views. Events colored by `posts.status` (`pending=blue`, `posting=amber`, `posted=green`, `failed=red`, `skipped=gray`, `blocked_*=orange-striped`).
   - **Drag-to-reschedule** writes `update-post-schedule` (already exists). Disabled for `status='posted'`.
   - **Bulk schedule from library:** the calendar shows a side panel "Library queue" with unscheduled library items. The user clicks **Auto-schedule** and picks one of:
     - **Cadence:** every N minutes/hours.
     - **Daily windows:** "every day between 09:00–11:00 and 18:00–20:00, max 4/day".
     - **Custom:** drag-drop tiles onto calendar slots.
   - Each library item dropped on the calendar materializes a `posts` row tied to the library item.
   - **Empty state**: "Generate a library first, or upload another audio clip."
   - **Blocked-state state**: events with `publish_status='blocked_account_not_connected'` show a "Connect TikTok" button in the event popover.
9. **Post Review side-panel.** Clicking any calendar event opens a sheet that mirrors the existing Post Review form (caption, hashtags, scheduled_at, privacy, duet/stitch/comment). Adds preview MP4 + provenance + a "View library item" link.
10. **Auto-publish.** Cron-driven `fanpage-publish-due` polls every 5 minutes, posts to TikTok Direct Post via the official API, and records every attempt in `publish_attempts`.

### 2.3 Required States

| Surface | State | Behavior |
| --- | --- | --- |
| Audio upload | empty / uploading / trimmed / too-long / unsupported-mime | inline banner; "trimmed" gates step 3. |
| Transcription | not_started / running / ready / failed | step 3 disabled until ready or manual override invoked. |
| Lyric template | draft / audio_ready / lyrics_processing / lyrics_ready / markers_ready / saved / failed / archived | Save Template only enabled at `lyrics_ready` or later. |
| Generation item | pending / planning / transcribing / picking_stock / generating / rendering / stitched / ready / complete / failed / skipped | dashboard pills + stage_events list. |
| Library item | not_ready / ready / scheduled / posted / blocked / failed | filter chips on `/library/:id`. |
| Post | pending / posting / posted / failed / skipped | calendar event color; sheet badge. |
| Post publish_status | ready / initializing / uploading / processing / publish_complete / failed / retry_scheduled / blocked_account_not_connected / blocked_missing_privacy / blocked_creator_restriction / blocked_missing_video | per-post chip; retry CTA when retryable. |
| Calendar | empty / loading / partial / blocked-banner | empty redirects to /library; blocked-banner surfaces when ≥1 due post is blocked. |

### 2.4 Progress Indicators

- Linear top-loader during edge function calls.
- Per-item status pill + segment progress (`segments[i].url` filled vs pending).
- Batch progress bar = `complete + failed + skipped / post_count`.
- Provider health chips (Pexels/Pixabay/FAL/GMI/TikTok) sourced from `fanpage-campaign?action=diagnostics`.

### 2.5 Template → Campaign linkage

- `generation_batches.lyric_template_id` and `generation_items.lyric_template_id` (already exist) bind a template to a batch.
- The Campaign form's template dropdown is pre-populated from `kanvas_lyric_templates` where `archived_at IS NULL` and `status IN ('lyrics_ready','markers_ready','saved')`. The "Create new template" button opens the wizard in a drawer for the active audio clip; the wizard returns the new id and selects it.
- A campaign **cannot start** without a template (relaxation: it can start with a "basic captions only" placeholder template that the renderer treats as no-subtitle).

### 2.6 Finalized Video Library Display

- One library per audio clip (`audio_clip_id`). Quantity is whatever the batch requested.
- Default sort: provenance-distinctness first (unique-provider items at top), then ascending `library_index`.
- Filter chips: All / Unscheduled / Scheduled / Posted / Blocked / Failed.
- Tile actions:
  - **Schedule…** opens a date-time picker; submits to `library-schedule` (see §4.7).
  - **Regenerate** calls `fanpage-campaign?action=regenerate { itemId }` and removes the tile until the new ready video lands.
  - **Replace one segment** opens a segment grid; tapping a segment opens the candidate picker (re-runs the source adapter with the same constraints and lets the user choose).
- Bulk scheduling: select N tiles → "Schedule on Calendar" → choose cadence preset or drag-drop on calendar.

---

## 3. Data Model

> All new tables include `created_at timestamptz default now()`, `updated_at timestamptz default now()`. All existing tables already include those columns. Naming is `snake_case`. All new tables `enable row level security` with the same anon/auth read policies the codebase already uses (`for select to anon, authenticated using (true)`). Service-role writes only.

### 3.1 Preserve and Refine Existing Tables

- `artists`, `accounts`, `agent_logs`, `worker_runs`, `publish_attempts`, `project_assets`, `kanvas_lyric_templates`, `kanvas_lyric_template_jobs` — **no schema changes**.
- `media_assets` — **no schema changes**. Add documentation that `metadata.thumbnail_url` is the post-thumbnail keyframe; `metadata.perceptual_hash` (pHash64) is required for `generated_video` and `rendered_video`.
- `generation_batches` — add columns (idempotent):
  - `audio_clip_id uuid` — FK to new `audio_clips(id)`.
  - `quantity int not null default 1` (alias of `post_count`; keep both for backward compat; new code reads `quantity`).
  - `dedupe_strategy text not null default 'strict'` — `strict | allow_reuse_after_exhaustion | allow_reuse_freely`.
  - `duration_tolerance_seconds int not null default 5` (preferred match window).
  - `duration_tolerance_fallback_seconds int not null default 10` (fallback).
  - `library_status text not null default 'building'` — `building | ready | exhausted | failed`.
  - Update `valid_generation_batch_source` constraint to allow the values `stock | mixed | seedance | gmi_seedance | sports_edit | streamer_clip`.
- `generation_items` — add columns:
  - `library_item_id uuid` — FK to new `video_library_items(id)` (nullable until the renderer finalizes).
  - `audio_clip_id uuid` — FK to `audio_clips(id)`.
  - `duration_tolerance_seconds_used int` — actual tolerance window matched (5 or 10).
  - `perceptual_hash text` — pHash64 of the final rendered MP4 keyframe set.
  - Update `valid_generation_item_status` to keep current set plus `'sourcing'` (alias of `picking_stock`).
- `posts` — add columns:
  - `library_item_id uuid` — FK to `video_library_items(id)` (nullable for back-compat).
  - `privacy_settings jsonb not null default '{}'::jsonb` — frozen platform options (TikTok subset today, future platforms TBD).
  - Update `valid_post_status` to keep current set; add separate enum `posts_publish_status_check`:
    `publish_status text` may be one of `ready | initializing | uploading | processing | publish_complete | failed | retry_scheduled | blocked_account_not_connected | blocked_missing_privacy | blocked_creator_restriction | blocked_missing_video`. Enforced via `check` constraint; null permitted only when the row is still being created.

### 3.2 New Tables

#### `audio_clips`
The user-facing artifact that says "this is the song clip I want a library for". One audio upload may yield multiple clips (different selections).

```sql
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
create index if not exists idx_audio_clips_account on public.audio_clips(account_id, created_at desc);
```

#### `video_library_items`
The finalized, viewer-ready lyric videos. One row per requested-quantity slot. This is the user-facing artifact between generation and scheduling.

```sql
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
```

#### `source_candidates`
Every clip ever considered by a source adapter — used for dedupe across batches.

```sql
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
```

#### `source_candidate_uses`
Ledger linking which candidates were assigned to which generation_item segments. The dedupe layer scans this when picking the next clip.

```sql
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
```

#### `render_attempts`
Granular history of stitch / karaoke render attempts (separate from `publish_attempts`).

```sql
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
```

#### `post_schedule_slots`
Saved scheduling presets (daily windows, cadence) that the bulk-scheduler can apply. Optional but referenced by §7.

```sql
create table if not exists public.post_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  rule jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### 3.3 Constraints & Uniqueness Summary

- `audio_clips.duration_sec ∈ {15,30,45,60,75,90}`.
- `generation_batches.quantity ≥ 1 AND ≤ 250`.
- `generation_batches.cadence_minutes BETWEEN 5 AND 10080`.
- `video_library_items` unique on `(audio_clip_id, library_index)` — guarantees exactly-N library slots.
- `source_candidates` unique on `(source_type, provider, external_id)` — single canonical record per public clip.
- `source_candidate_uses` unique on `(generation_item_id, segment_index)` — prevents double-counting.
- `posts.scheduled_at NOT NULL` (already enforced); add `check (scheduled_at >= '2024-01-01'::timestamptz)` as a sanity rail.
- `posts.publish_status` enforced via check constraint listed in §3.1.

### 3.4 RLS

- All new tables: `enable row level security` with `for select to anon, authenticated using (true)` and no insert/update/delete policy (service-role writes only).
- `audio_clips`, `video_library_items`, `source_candidates`, `source_candidate_uses`, `render_attempts`, `post_schedule_slots` follow the same pattern.

### 3.5 Storage

- Buckets stay the same: `post-assets` (public), `audio-uploads` (private), `stock-cache` (private), `renders` (private). File-size limit already raised to 200 MB.
- Add a public `thumbnails` bucket (file size limit 5 MB) for library tile thumbnails. Migration must `insert into storage.buckets (id, name, public, file_size_limit) values ('thumbnails','thumbnails',true,5*1024*1024) on conflict (id) do nothing;` and add the same `select` policy for anon/auth.

### 3.6 Migration ordering

A new migration file `supabase/migrations/20260518120000_fanagent_video_library.sql` performs all of the above DDL in one transaction-safe block. It must:

1. Create new tables and indexes (`audio_clips`, `video_library_items`, `source_candidates`, `source_candidate_uses`, `render_attempts`, `post_schedule_slots`).
2. Add new columns to `generation_batches`, `generation_items`, `posts`.
3. Update constraints (`valid_generation_batch_source` to include `sports_edit`, `streamer_clip`; add `posts_publish_status_check`).
4. Backfill `audio_clips` from existing `generation_batches.audio_asset_id` rows (one row per existing batch, deriving `duration_sec` from `generation_batches.duration_seconds`, `selection_start_sec=0`, `selection_end_sec=duration_seconds`).
5. Backfill `video_library_items` from existing `generation_items` where `final_asset_id IS NOT NULL`, with `library_index = item_index`.
6. Link `posts.library_item_id` from `posts.generation_item_id → video_library_items.generation_item_id`.
7. Create `thumbnails` bucket.

Migration uses `if not exists` / `if exists` consistently; idempotent on re-run.

---

## 4. Backend / Edge Functions

> All FanAgent edge function HTTP responses MUST conform to a single envelope:
>
> ```json
> {
>   "success": true,
>   "code": "OK",
>   "message": "...",
>   "data": { ... },
>   "error": null,
>   "errorDetail": null
> }
> ```
>
> On failure: `success:false`, `code` is a stable `UPPER_SNAKE` string (e.g. `INVALID_AUDIO_MIME`, `TIKTOK_NOT_CONNECTED`, `TOLERANCE_EXCEEDED`), `error` is human-readable, `errorDetail` carries the serialized error from `_shared/errors.ts`. CORS handled by `_shared/cors.ts`.
>
> Canonical sub-objects (modeled after GenViral):
>
> - **`media`**: `{ asset_id, public_url, mime_type, duration_seconds, width, height, perceptual_hash, source: { type, provider, external_id, license, attribution } }`.
> - **`accounts`**: `[ { id, platform, handle, status, tiktok: { connected, display_name, creator_info } } ]`.
> - **`scheduled_at`**: ISO-8601 UTC.
> - **`tiktok_options`**: `{ privacy_level, disable_duet, disable_stitch, disable_comment, is_aigc, brand_content_toggle, brand_organic_toggle }`.

### 4.1 Function Inventory (functions Codex must own)

| Function | Type | Role |
| --- | --- | --- |
| `audio-clip-register` (NEW) | user-facing | Accepts uploaded audio, creates `media_assets` + `audio_clips`, returns the clip. |
| `audio-clip-transcribe` (NEW thin wrapper) | user-facing | Triggers transcription on an `audio_clips.id`, updates `audio_clips.transcription_status`, returns transcript + suggested lyric blocks. |
| `kanvas-lyrics-template` | existing | CRUD on templates; extended with `action: 'createFromAudioClip'`. |
| `kanvas-lyrics-transcribe` | existing | Per-template transcription; left as-is. |
| `kanvas-lyrics-audio-register` | existing | Per-template audio register; left as-is. |
| `fanpage-campaign` | existing | Single user-facing entrypoint, action-dispatched. EXTENDED. |
| `create-generation-batch` | existing | Internal: registers a batch and N `generation_items`. EXTENDED to also create `audio_clips` if not provided and to pre-create `video_library_items` rows. |
| `generate-video-prompts` | existing | Optional Lovable-driven per-item prompt enrichment. Unchanged. |
| `pick-stock-clip` | existing | RENAMED LOGICALLY to "pick-source-clip" (path unchanged for back-compat), but the inner logic dispatches to the source adapter registry. |
| `generate-seedance-clip` | existing | Single Seedance segment via fal.ai. Unchanged. |
| `stitch-segments` | existing | Stitches segments + audio. Unchanged shape; adds an entry in `render_attempts`. |
| `render-karaoke` | existing | Adds lyric subtitles + thumbnail. EXTENDED to populate `video_library_items` row. |
| `fanpage-generate-due` | existing | Cron worker. EXTENDED to call `library-finalize` instead of inserting `posts` directly. |
| `library-finalize` (NEW) | internal | Materializes a `video_library_items` row when a `generation_items` row reaches `ready`. |
| `library-schedule` (NEW) | user-facing | Schedules N library items: takes `[ { libraryItemId, scheduledAt, tiktokOptions, caption?, hashtags? } ]`, validates, creates `posts`. |
| `library-bulk-schedule` (NEW) | user-facing | Applies a cadence/window rule to N library items; resolves to N `posts`. |
| `update-post-schedule` | existing | Edits post fields; extended to accept `privacy_settings` and to reject edits when `status='posted'`. |
| `fanpage-publish-due` | existing | Cron worker; cron-secured wrapper of `publish-tiktok-due`. EXTENDED to emit `render_attempts`/`publish_attempts` rows. |
| `publish-tiktok-due` | existing | Official TikTok Direct Post. EXTENDED to surface `blocked_*` publish_status values and store `privacy_settings`. |
| `tiktok-oauth-callback` | existing | Connect/return. Unchanged. |
| `process-generation-due` | existing | Legacy worker; retained for back-compat. Marked deprecated in code comments. |
| `render-callback` | existing | Legacy render webhook; retained. |
| `source-candidate-search` (NEW) | internal | Adapter-routed search; returns ranked candidates. |
| `source-candidate-replace` (NEW) | user-facing | Re-runs the adapter for a single segment and swaps the chosen candidate. |

### 4.2 Generation Orchestration Stages

Stages map 1:1 to the `generation_items.status` machine and to `render_attempts.stage`:

1. **Register audio** — `POST /audio-clip-register`
   - Request: `{ accountId, audioBase64, audioMimeType, audioFileName, clipSelection: { startSec, endSec, durationSec } }`.
   - Response data: `{ audio_clip: { id, duration_sec, file_name }, media: <canonical> }`.
   - Validation: MIME ∈ supported set, byte size ≤ 50 MB, `durationSec ∈ {15,30,45,60,75,90}`, `endSec > startSec`.

2. **Transcribe lyrics** — `POST /audio-clip-transcribe`
   - Request: `{ audioClipId, force?: boolean }`.
   - Response data: `{ audio_clip, transcript: { language, words[], blocks[] } }`.
   - Idempotent unless `force=true`.

3. **Save editable template** — `POST /kanvas-lyrics-template` `action='create'` or `action='patch'`.
   - Already exists; unchanged.

4. **Create generation batch** — `POST /fanpage-campaign` `action='create'`.
   - Request:
     ```json
     {
       "action":"create",
       "accountId":"…",
       "audioClipId":"…",
       "lyricTemplateId":"…",
       "quantity":20,
       "sourceMode":"stock|mixed|seedance|gmi_seedance|sports_edit|streamer_clip",
       "prompt":"...",
       "sourceSettings": { ... },          // shape varies per adapter, see §5
       "schedule": { "startAt":"ISO", "cadenceMinutes":1440, "timezone":"…" },
       "publishDefaults": { "privacyLevel":"…", "disableDuet":true, "disableStitch":true, "disableComment":false, "isAigc":true, "brandContentToggle":false, "brandOrganicToggle":false },
       "durationTolerance": { "preferredSeconds":5, "fallbackSeconds":10 },
       "dedupeStrategy":"strict|allow_reuse_after_exhaustion|allow_reuse_freely"
     }
     ```
   - Response data: `{ batch, audio_clip, video_library_items: [...], items_total: N }`.
   - Internally proxies to `create-generation-batch`, which:
     1. Validates payload (same validators currently in `create-generation-batch/index.ts`, extended for `audioClipId` instead of inline `audioBase64`).
     2. Creates `generation_batches` row with the new columns.
     3. Pre-creates `video_library_items` rows (`library_index` 0..N-1, `status='not_ready'`).
     4. Inserts `generation_items` rows linked to both `batch_id` and `library_item_id`.
     5. Returns the envelope above.

5. **Source clips** — `pick-stock-clip` (path retained) now dispatches by `generation_batches.source_mode`:
   - For each segment, calls `source-candidate-search` (internal) with adapter inputs.
   - Adapter returns a ranked list of `source_candidates` (inserted or matched on `(source_type, provider, external_id)`).
   - Selector applies duration tolerance (`±5s` → fallback `±10s`) and dedupe against `source_candidate_uses` rows for the same `audio_clip_id` (preferred) and `account_id` (fallback). Strategy from `generation_batches.dedupe_strategy`.
   - Writes `source_candidate_uses` row.
   - For `seedance`/`gmi_seedance` segments, the candidate is virtual (no external id) and the adapter returns a `prompt` only; `pick-stock-clip` flags the segment as `seedance` and leaves `url` null.

6. **Generate Seedance clips** — `generate-seedance-clip` (existing). Adds a `render_attempts` row.

7. **Stitch** — `stitch-segments` (existing). Adds a `render_attempts` row.

8. **Render karaoke subtitles** — `render-karaoke` (existing). On success calls `library-finalize` (internal) to materialize the `video_library_items` row.

9. **Library finalize** — `POST /library-finalize` `{ generationItemId }`
   - Updates the pre-created `video_library_items` row: `final_asset_id`, `thumbnail_url`, `segments`, `provenance`, `perceptual_hash`, `default_caption`, `default_hashtags`, `status='ready'`.
   - Increments the batch's `library_status` if all items are ready or exhausted.

10. **Create scheduled posts** — `POST /library-schedule` (single) or `POST /library-bulk-schedule` (bulk).
    - Single request:
      ```json
      {
        "items":[
          {
            "libraryItemId":"…",
            "scheduledAt":"ISO",
            "caption":"…",
            "hashtags":["#fyp"],
            "tiktokOptions":{ "privacyLevel":"SELF_ONLY","disableDuet":true,"disableStitch":true,"disableComment":false,"isAigc":true,"brandContentToggle":false,"brandOrganicToggle":false }
          }
        ]
      }
      ```
    - Bulk request:
      ```json
      {
        "libraryItemIds":["…","…"],
        "rule":{ "type":"cadence","startAt":"ISO","everyMinutes":240 },
        "tiktokOptions":{ ... },
        "captionTemplate":"{hookText} — sound on",
        "hashtags":["#fyp","#music"]
      }
      ```
      Supported `rule.type` values: `cadence`, `daily_windows`, `manual_slots`. `daily_windows` schema: `{ type:"daily_windows", windows:[{ start:"09:00", end:"11:00" }], maxPerDay:4, timezone:"…", startDate:"YYYY-MM-DD" }`.
    - Response data: `{ posts: [...], blockedReasons: [...] }`.
    - Validation: rejects items where `video_library_items.status != 'ready'`; rejects past scheduled_at by more than 1 minute; clamps to ≤ 50 posts per call.

11. **Publish due posts** — `fanpage-publish-due` cron handles publishing as today.

### 4.3 Worker Locking, Retries, Idempotency

- Generation workers continue to use `claim_generation_items(p_limit, p_worker_id, p_claim_window_minutes)` — `FOR UPDATE SKIP LOCKED`. `MAX_PER_RUN` stays at `1` to keep per-run latency bounded; raise to `3` only behind env `FANAGENT_GENERATE_MAX_PER_RUN`.
- `attempt_count`/`max_attempts` (default 3, idle-timeout escalates to 5) preserved.
- Publishing workers iterate "one per account per run" to spread quota.
- Every external POST sets an idempotency key derived from `generation_items.id + ':' + stage` for stitch/karaoke and `posts.id + ':' + init` for TikTok init. Idempotency keys live in `agent_logs.detail.idempotency_key` for debugging; provider-side idempotency is enforced by passing the key as a header when supported (FAL/GMI ignore it; TikTok's `init` is idempotent by `publish_id`).
- Retries follow `isRetryable(err)` (codes `408,409,429,500,502,503,504,timeout,rate_limit,temporar,network`) — preserved from current code.
- Blocked publishes set `publish_status` to a specific `blocked_*` value and do NOT increment `retry_count`. They are surfaced in the dashboard's "Needs attention" list and re-checked every 30 minutes.

### 4.4 Diagnostics Contract

`fanpage-campaign?action=diagnostics` returns:

```json
{
  "success": true, "code":"OK", "data":{
    "env":{ "supabaseUrl":true, "serviceRole":true, "cronSecret":true,
            "tiktokClientKey":true, "tiktokClientSecret":true, "tiktokRedirectUri":true,
            "tokenEncryptionKey":true, "pexels":true, "pixabay":false,
            "fal":true, "gmi":false, "elevenLabs":true, "lovable":false,
            "twitchClientId":false, "twitchClientSecret":false, "youtubeApiKey":false },
    "buckets":[ {"name":"post-assets","ok":true}, {"name":"audio-uploads","ok":true},
                {"name":"stock-cache","ok":true}, {"name":"renders","ok":true},
                {"name":"thumbnails","ok":true} ],
    "account":{ "id":"…","platform":"tiktok","handle":"…","tiktokConnected":true,
                "tiktokCreatorInfo":{ ... } },
    "queueCounts":{ "pending":3,"generating":1,"failed":0 },
    "blockedPublishCounts":{ "blocked_account_not_connected":2 },
    "schema":{ "videoLibrary":true, "sourceCandidates":true, "renderAttempts":true,
               "errors":[] },
    "cron":{ "configured":true, "schedule":"*/5 * * * *", "detectable":false }
  }
}
```

### 4.5 Internal vs External Calls

- **Public via Supabase SDK**: `fanpage-campaign`, `audio-clip-register`, `audio-clip-transcribe`, `library-schedule`, `library-bulk-schedule`, `update-post-schedule`, `kanvas-lyrics-*`, `source-candidate-replace`, `tiktok-oauth-callback`. These use anon-key auth + service-role inside the function.
- **Internal-only**: `create-generation-batch`, `pick-stock-clip`, `generate-seedance-clip`, `stitch-segments`, `render-karaoke`, `library-finalize`, `source-candidate-search`, `generate-video-prompts`. Reachable only via `fetch` from another edge function (no client SDK use).
- **Cron-only**: `fanpage-generate-due`, `fanpage-publish-due`, `process-generation-due`. Protected by `x-cron-secret` (existing `isAuthorizedCronCall`).

### 4.6 Audio Register Response Shape

```json
{
  "success": true, "code":"OK",
  "data":{
    "audio_clip":{
      "id":"uuid","duration_sec":30,"file_name":"…","perceptual_hash":"…",
      "transcription_status":"running","selection_start_sec":12.3,"selection_end_sec":42.3
    },
    "media":{
      "asset_id":"uuid","public_url":"…","mime_type":"audio/wav",
      "duration_seconds":30,"source":{"type":"audio","provider":"upload"}
    }
  }
}
```

### 4.7 Library Schedule Response Shape

```json
{
  "success": true,"code":"OK",
  "data":{
    "posts":[
      {
        "id":"uuid","library_item_id":"uuid","status":"pending",
        "publish_status":"ready","scheduled_at":"…",
        "media":{ "asset_id":"…","public_url":"…","mime_type":"video/mp4",
                  "duration_seconds":30 },
        "tiktok_options":{ "privacy_level":"SELF_ONLY","disable_duet":true,
                          "disable_stitch":true,"disable_comment":false,
                          "is_aigc":true,"brand_content_toggle":false,
                          "brand_organic_toggle":false },
        "caption":"…","hashtags":["#fyp"]
      }
    ],
    "blocked":[
      { "library_item_id":"uuid","reason":"NOT_READY","detail":"library item still rendering" }
    ]
  }
}
```

### 4.8 Update Post Schedule

Extension of the existing `update-post-schedule`:

- Accepts `privacySettings: { ... }` JSON which is merged into `posts.privacy_settings`.
- Rejects `scheduledAt` more than 90 days in the future.
- On success returns `{ post: <full row> }` in the envelope.

### 4.9 Source Candidate Replace

`POST /source-candidate-replace`:

```json
{ "libraryItemId":"…", "segmentIndex":2, "candidateId":"…" }
```

- Validates the candidate matches the segment's `source_type` and tolerance.
- Re-runs `stitch-segments` and `render-karaoke` only.
- Updates `video_library_items` row in place; emits `render_attempts` rows.

### 4.10 Publishing Endpoint Surface

`publish-tiktok-due` response stays as today (array of result objects), but each result becomes envelope-shaped:

```json
{
  "id":"<post_id>",
  "status":"PUBLISH_COMPLETE" | "PROCESSING_UPLOAD" | "FAILED" | "blocked_account_not_connected" | "retry_scheduled",
  "publishId":"…",
  "error":null,
  "errorDetail":null
}
```

---

## 5. Clip Sourcing Strategy

### 5.1 Adapter Contract

All source adapters live in `supabase/functions/_shared/sources/` and implement:

```ts
export interface SourceAdapter {
  type: 'stock'|'library'|'seedance'|'gmi_seedance'|'sports_edit'|'streamer_clip';
  search(input: AdapterSearchInput): Promise<SourceCandidate[]>;
  cache(candidate: SourceCandidate): Promise<{ url: string; storage_path?: string }>;
  describeLicense(candidate: SourceCandidate): { license: string; rights_holder?: string; attribution?: string };
}
```

`AdapterSearchInput`:

```ts
{
  accountId: string;
  audioClipId: string;
  query: string;
  targetDurationSec: number;
  tolerancePreferredSec: number;   // 5
  toleranceFallbackSec: number;    // 10
  portraitOnly: boolean;           // true by default
  keywords?: string[];
  negativeKeywords?: string[];
  category?: string;
  mood?: string;
  perAdapterLimit?: number;        // default 20
  adapterSettings?: Record<string, unknown>;
}
```

`SourceCandidate` mirrors the `source_candidates` table columns plus a `score` and a `tolerance_seconds_used` derived field.

### 5.2 Built-in Adapters

| Adapter | Backing API | License | Notes |
| --- | --- | --- | --- |
| `stock` | Pexels Videos + Pixabay Videos | Pexels/Pixabay free licenses | Existing logic, retained. |
| `library` | `media_assets` rows owned by `accountId` | user-owned | Existing. |
| `seedance` | fal.ai `bytedance/seedance-2.0/fast/text-to-video` | generated | Existing. |
| `gmi_seedance` | GMI Cloud `Seedance-2.0` | generated | Existing. |
| `sports_edit` | YouTube Data API v3 (search + videos) **only** for channels in `SPORTS_EDITS_ALLOWED_CHANNELS` (comma-separated env), or user-supplied IDs from owned/licensed channels. License = `youtube_owner_provided`. | Default disabled. Adapter refuses to run unless the env list is set or the user supplied owned channel IDs. |
| `streamer_clip` | Twitch Helix `clips` for streamers in `STREAMER_CLIP_ALLOWED_CHANNELS` (env or per-account allowlist). License = `twitch_creator_rights`. | Default disabled. Adapter requires explicit allowlist entries and persists `attribution` (creator name + clip URL) in the candidate row. |

> Both `sports_edit` and `streamer_clip` adapters are scaffolded but ship **disabled by default**. Codex must implement them with allowlists, license capture, and provenance display; enabling them is an operator decision (set env). They MUST use only official APIs (YouTube Data, Twitch Helix) and refuse on missing creds.

### 5.3 Provenance & Rights

- `source_candidates.license` ∈ `pexels|pixabay|user_library|generated_seedance|generated_gmi_seedance|youtube_owner_provided|twitch_creator_rights|unknown`.
- Adapters MUST refuse to ingest a clip without resolving to one of the allowed license strings.
- `source_candidates.attribution` is required for `youtube_owner_provided` and `twitch_creator_rights`. Library tile shows the attribution string in the tile metadata and includes it in `posts.metadata.attributions[]` so the user can paste it into the caption when required.
- `expires_at` is set for any URL with a known TTL (Twitch clips have rotating thumbnails; cache the MP4 to `stock-cache` and persist the storage path). For `sports_edit` the adapter only ever stores YouTube videoIds — playback at render time is performed via `yt-dlp`-free official means: the function downloads the user-permitted MP4 from the channel's owner-uploaded asset URL provided via env / user upload. There is **no public YouTube URL scraping**.

### 5.4 Duration Filtering

The selector applies:

1. Filter candidates to `is_portrait = true` (when adapter offers landscape variants, drop them).
2. Filter to `|c.duration_seconds - segmentDur| ≤ 5`. If ≥ 1 candidate remains, use them.
3. Otherwise filter to `|c.duration_seconds - segmentDur| ≤ 10`. Record `tolerance_seconds_used = 10` on the chosen `source_candidate_uses` row and on `generation_items.duration_tolerance_seconds_used`.
4. If no candidate fits, the selector returns `null` for that segment. The orchestrator marks the segment as `seedance` (when `sourceMode in ('mixed','sports_edit','streamer_clip','stock')` and FAL is available) or fails the item with `TOLERANCE_EXCEEDED` if neither stock fallback nor Seedance is allowed.

### 5.5 Dedupe

Dedupe runs in this order against `source_candidate_uses`:

1. **Within the same `audio_clip_id`** — never reuse a clip's `(source_type, provider, external_id)` or `origin_url` or matching `perceptual_hash` (pHash distance ≤ 6) within the same library.
2. **Within the same `account_id`** — if `dedupe_strategy = 'strict'`, skip candidates used by this account in the last 30 days; if `allow_reuse_after_exhaustion`, fall back to reusable candidates when none unique remain.
3. **Visual reuse marking** — when `reused=true`, set `video_library_items.reused_flags.<segmentIndex> = true` and the library tile shows the amber "reused" chip.
4. **Seedance/GMI** generations are never marked reused (each generation is unique by construction), but their `perceptual_hash` is still stored to catch model-collapsed outputs.

### 5.6 Source Candidate Search Function

`POST /source-candidate-search`:

```json
{
  "audioClipId":"…",
  "segments":[
    { "segmentIndex":0, "sourceType":"stock", "targetDurationSec":15,
      "query":"neon late-night crowd silhouettes", "settings":{ ... } }
  ]
}
```

Response data: `{ candidates: { [segmentIndex]: SourceCandidate[] } }`. The caller (currently `pick-stock-clip`) applies the duration filter and dedupe before writing `source_candidate_uses`.

---

## 6. Rendering / Lyrics

### 6.1 Transcription Template Model

- `kanvas_lyric_templates.lyric_blocks` is the editable source of truth — array of `{ id, label, startTime, endTime, words: [{ id, text, startTime, endTime, confidence? }] }`. UI uses seconds; storage uses ms.
- `kanvas_lyric_templates.cut_markers` is an array of ms timestamps used by the karaoke renderer to enforce visual cuts at chosen lyric beats.
- The template is independent of the audio clip used in generation: one template per (audio_clip, edit_session). The campaign references a single `lyricTemplateId`; per-item override is supported via `generation_items.lyric_template_id`.

### 6.2 Segmentation By Duration

The generation pipeline splits each item into N visual segments where:

| Duration | Segments | Segment length |
| --- | --- | --- |
| 15s | 1 | 15s |
| 30s | 2 | 15s each |
| 45s | 3 | 15s each |
| 60s | 4 | 15s each |
| 75s | 5 | 15s each |
| 90s | 6 | 15s each |

This is enforced in `pick-stock-clip` (`segCount = Math.ceil(total/15)`, segment duration = floor of even split, clamped 1–15s).

### 6.3 Stitching Behavior

- **15s, single segment**: `mergeAudioVideo(videoUrl, audioUrl)` only. No `compose`.
- **30s+ multi-segment**: `mergeVideos([url0, url1, ...])` followed by `mergeAudioVideo(stitched, audio)`. On `IDLE_TIMEOUT` fallback: `mergeAudioVideo(url0, audio)` and mark `stitchMode='single_visual_timeout_fallback'`.
- **With non-uniform segment lengths** (rare, e.g. when adapter returned a clip 9–11s instead of 15s): use `compose` with explicit per-segment trim windows.
- Marker-driven trims (`cut_markers` enforced in stitch) — switch to `compose` with trim points at each cut marker.

### 6.4 Karaoke Rendering

- `render-karaoke` always re-hosts the final MP4 in the `renders` bucket via `createMediaAssetFromBytes`. This guarantees durable links.
- Subtitle generation reads `lyric_blocks`, converts to SRT, uploads SRT to `post-assets/subtitles/<itemId>-<timestamp>.srt`, and passes the public SRT URL into `composeWithSubtitles`.
- If `lyric_blocks` is empty (or `lyric_template_id` is null), `render-karaoke` skips subtitle compose and runs only the durable re-host step.
- Always attempts thumbnail extraction via `extractFrame(finalUrl, 'middle')`. On success, upload to the `thumbnails` bucket as `thumbnails/<libraryItemId>.jpg` and set `video_library_items.thumbnail_url`.

### 6.5 Final MP4 Storage

- All finalized MP4s are stored in the **`renders`** private bucket with path `renders/<accountId>/<libraryItemId>.mp4`. A signed URL is what `posts.video_url` carries (signed for 7 days; refreshed by `library-finalize` if the post is more than 6 days from publish).
- Thumbnails live in **public** `thumbnails` bucket.
- Lyric SRTs live in **public** `post-assets/subtitles/`.
- Original audio lives in private `audio-uploads`.
- `media_assets` rows always carry `metadata.original_url`, `metadata.generation_item_id`, `metadata.lyric_template_id`, `metadata.perceptual_hash`.

### 6.6 Regeneration

- **Whole-item regenerate** (`fanpage-campaign?action=regenerate`): resets the `generation_items` row, clears `source_candidate_uses` for that item, marks linked `video_library_items.status='not_ready'`, sets linked posts to `status='skipped', publish_status='regenerated'` (unless already posted).
- **Segment-only regenerate** (`source-candidate-replace`): preserves other segments, re-runs only stitch + karaoke.

---

## 7. Publishing / Calendar

### 7.1 Calendar UI

- Base component remains `FanAgentCalendar` (FullCalendar dayGrid + timeGrid + interaction).
- Promoted to its own route `/calendar`, with a side panel showing **unscheduled library items** for the active account.
- View toggle: `Month | Week | Day | Agenda`.
- Filters: account, audio clip, status.
- Color legend matches the status colors in §2.

### 7.2 Drag-to-Reschedule

- Existing behavior preserved.
- Drop targets in the past are rejected with a toast "Cannot reschedule into the past."
- Drops onto events with `status='posted'` are rejected.
- Drag from the library side panel onto a calendar slot creates a `posts` row via `library-schedule`.

### 7.3 Bulk Scheduling

- "Schedule selected" opens a modal with three modes:
  1. **Cadence**: `Start at` + `every N minutes`.
  2. **Daily windows**: pick `windows: [{ start, end }]`, `maxPerDay`, `startDate`, `timezone`. The scheduler distributes items round-robin across windows.
  3. **Manual**: shows a date-time field per selected item.
- Submit → `library-bulk-schedule`.

### 7.4 Per-Post Edit

- Click an event → side sheet with caption, hashtags, `scheduledAt`, `privacy_settings`, duet/stitch/comment toggles, AIGC flag, brand-content flag, preview MP4, library item link.
- Save calls `update-post-schedule`. Posted posts are read-only (the sheet shows the live TikTok URL when available).

### 7.5 Privacy & TikTok Options

- Privacy options come from `accounts.tiktok_creator_info.privacy_level_options`. UI disables non-available options.
- If `creator_info.comment_disabled=true`, the comment toggle is locked on.
- AIGC label defaults `true` for all generated content (Seedance/GMI). For pure stock/library items, the default is `false`; user can override.

### 7.6 Post Status Lifecycle

- `pending` (default) → `posting` (in-flight to TikTok) → `posted` (success) or `failed` (terminal) or `skipped` (user-initiated).
- `publish_status` independent finer-grained tracker:
  - `ready`: ready to publish (post created from library).
  - `initializing` / `uploading` / `processing` / `publish_complete`: from TikTok status API.
  - `retry_scheduled`: retryable error; `scheduled_at` was bumped exponentially (5,10,20,40,80,160 minutes capped at 240).
  - `failed`: non-retryable error.
  - `blocked_account_not_connected`: TikTok account not authenticated.
  - `blocked_missing_privacy`: privacy level not set.
  - `blocked_creator_restriction`: creator_info conflict.
  - `blocked_missing_video`: `video_url` empty (library item not yet ready).
- Blocked statuses never increment `retry_count` and the post remains `status='pending'` so it re-enters the publish loop on the next cron tick once unblocked.

### 7.7 Compliance Rails

- Publishing exclusively uses TikTok Direct Post (official API).
- No anti-detection, header spoofing, device-farming, or ToS-evading code anywhere in the repo. Spec forbids it.
- Audio uploads are limited to user-owned audio. The Audio Register UI shows a one-line disclaimer: "You must have rights to publish this audio."
- Sports & streamer adapters are off by default and require explicit allowlists, with attribution displayed and copied into post metadata.

---

## 8. Environment Variables / Setup

> The repo distinguishes **provider-issued secrets** (issued by third parties, e.g. `PEXELS_API_KEY`) and **internally generated secrets** (created by the operator, e.g. `CRON_SECRET`, `TOKEN_ENCRYPTION_KEY`).

### 8.1 Required (provider-issued)

- `SUPABASE_URL` (Supabase) — project URL.
- `SUPABASE_ANON_KEY` — public.
- `SUPABASE_SERVICE_ROLE_KEY` — service role for edge functions.
- `FAL_KEY` — fal.ai (Seedance, ffmpeg-api).
- `ELEVENLABS_API_KEY` — transcription.
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` — TikTok OAuth + Direct Post.

### 8.2 Required (internally generated)

- `CRON_SECRET` — sent as `x-cron-secret` header by Supabase Cron; verified by `isAuthorizedCronCall`.
- `TOKEN_ENCRYPTION_KEY` — 32-byte AES-GCM key for `crypto.ts` (TikTok token encryption at rest).
- `SITE_URL` — used in OAuth callback redirects.

### 8.3 Optional (provider-issued — features auto-enable when present)

- `PEXELS_API_KEY` — stock provider.
- `PIXABAY_API_KEY` — stock provider.
- `GMI_API_KEY` (or `GMI_CLOUD_API_KEY`) — GMI Seedance.
- `GMI_ORG_ID`, `GMI_SEEDANCE_MODEL_ID`, `GMI_API_BASE` — GMI variants.
- `LOVABLE_API_KEY` — best-effort prompt enrichment via `generate-video-prompts`.
- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `STREAMER_CLIP_ALLOWED_CHANNELS` — streamer adapter.
- `YOUTUBE_API_KEY`, `SPORTS_EDITS_ALLOWED_CHANNELS` — sports adapter (channel IDs only, owner-uploaded URLs supplied per-batch).
- `SEEDANCE_MODEL_ID` — override for fal Seedance model (default `bytedance/seedance-2.0/fast/text-to-video`).
- `FANAGENT_GENERATE_MAX_PER_RUN` — integer, default 1.
- `FANAGENT_GENVIRAL_TOKEN` — optional internal token for any operator-side GenViral parity integrations (reserved; not used by app code unless feature-flagged). Treated as **internally generated** secret.

### 8.4 Frontend `.env`

Already in the repo:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.

No other secrets are exposed to the frontend.

### 8.5 Cron Wiring

After deploy, the operator runs the SQL in `supabase/migrations/20260512212933_fanagent_reliability_queue.sql` (the commented Cron block) to schedule:

- `fanagent-generate-due` every 5 minutes.
- `fanagent-publish-due` every 5 minutes.

Vault keys:

- `fanagent_project_url`
- `fanagent_cron_secret`
- `fanagent_anon_key` (optional for the legacy `process-generation-due`)

---

## 9. Implementation Plan

Codex implements phases in order. Each phase ships independently, behind a feature flag where noted, and merges to `main` only when its tests pass.

### Phase 0 — Repo Bootstrap (no behavior change)

- Create `goal/spec.md` (this document).
- Add `tsconfig` paths for `@/lib/library/*`, `@/lib/sources/*`, `@/lib/calendar/*`.
- Add lint rule that bans `node-fetch` and DOM-only globals in `supabase/functions/_shared/`.

### Phase 1 — Database Schema

- New migration `supabase/migrations/20260518120000_fanagent_video_library.sql` as defined in §3.6.
- New `thumbnails` bucket.
- Update `_shared/generation.ts` to include `audio_clip_id`, `library_item_id`, tolerance fields when building payloads.
- Files touched: `supabase/migrations/20260518120000_fanagent_video_library.sql`, `supabase/functions/_shared/generation.ts`.

### Phase 2 — Audio Clip + Library Plumbing

- Implement `audio-clip-register` and `audio-clip-transcribe` functions (built on top of `transcribe-audio` shared helpers).
- Refactor `create-generation-batch` to:
  - Accept either inline `audioBase64` (legacy) or `audioClipId` (new).
  - Pre-create `video_library_items` rows.
- Implement `library-finalize` and wire `render-karaoke` to call it at the end.
- Files touched: `supabase/functions/audio-clip-register/index.ts` (new), `supabase/functions/audio-clip-transcribe/index.ts` (new), `supabase/functions/create-generation-batch/index.ts`, `supabase/functions/render-karaoke/index.ts`, `supabase/functions/library-finalize/index.ts` (new).

### Phase 3 — Source Adapter Registry

- Create `supabase/functions/_shared/sources/` with files: `registry.ts`, `stock.ts` (extract existing logic), `library.ts`, `seedance.ts`, `gmi.ts`, `sports_edit.ts`, `streamer_clip.ts`, `dedupe.ts`, `filters.ts`.
- Move the existing `stock.ts` body under `_shared/sources/stock.ts` and re-export from `_shared/stock.ts` for back-compat until callers update.
- Implement `source-candidate-search` and `source-candidate-replace` edge functions.
- Wire `pick-stock-clip` to dispatch through the registry by `source_mode`.
- Persist `source_candidates` + `source_candidate_uses` rows.
- Files touched: `supabase/functions/_shared/sources/*`, `supabase/functions/pick-stock-clip/index.ts`, `supabase/functions/source-candidate-search/index.ts` (new), `supabase/functions/source-candidate-replace/index.ts` (new).

### Phase 4 — Duration / Dedupe Enforcement

- Add `_shared/sources/filters.ts` with `filterByDuration(candidates, segmentDur, preferred=5, fallback=10)` and `filterPortrait(candidates)`.
- Add `_shared/sources/dedupe.ts` with `selectUnique(candidates, usedKeys, strategy)`.
- Replace `selectStockCandidate` usage with `selectUnique`.
- Persist `tolerance_seconds_used` on `source_candidate_uses` and `generation_items.duration_tolerance_seconds_used`.
- Unit tests in `tests/sources.test.ts`.

### Phase 5 — Campaign API Refactor

- Extend `fanpage-campaign` with the GenViral envelope, plus actions: `create` (new payload), `regenerate`, `recoverRecentFailures`, `setLyricTemplate`, `diagnostics`, `list`. Existing actions preserved for back-compat.
- Add response normalizer in `_shared/envelope.ts`.
- Files touched: `supabase/functions/fanpage-campaign/index.ts`, `supabase/functions/_shared/envelope.ts` (new).

### Phase 6 — Library UI

- New route `/library/:audioClipId` and global `/library` listing audio clips.
- Component `LibraryGrid.tsx` with filter chips, bulk select, regenerate, replace-segment dialog.
- Use Supabase JS client to read `video_library_items` + joined `media_assets`.
- Files touched: `src/pages/library/LibraryLanding.tsx` (new), `src/pages/library/LibraryDetail.tsx` (new), `src/components/library/LibraryGrid.tsx` (new), `src/components/library/LibraryTile.tsx` (new), `src/components/library/SegmentReplaceDialog.tsx` (new), `src/main.tsx` (add routes).

### Phase 7 — Calendar UI

- Promote `/calendar` to a dedicated route with a library side panel.
- Add `BulkScheduleDialog.tsx` with cadence / daily-windows / manual modes.
- Wire `library-schedule` + `library-bulk-schedule`.
- Drag from library to calendar materializes a post.
- Files touched: `src/pages/calendar/CalendarPage.tsx` (new), `src/components/calendar/BulkScheduleDialog.tsx` (new), `src/components/FanAgentCalendar.tsx` (add side panel + drop handler), `src/main.tsx`.

### Phase 8 — Autopilot Wizard Polish

- Refactor `AutopilotPanel.tsx` into stepped components (`ConnectStep`, `UploadStep`, `LyricsStep`, `CampaignStep`).
- Lyrics drawer auto-opens after transcription completes.
- Source mode picker shows all adapters in the registry; disables those with missing env.
- Files touched: `src/components/AutopilotPanel.tsx`, `src/components/autopilot/*`.

### Phase 9 — Publish Hardening

- Extend `publish-tiktok-due` to set the new `blocked_*` `publish_status` values via the helpers in `_shared/tiktok.ts`.
- Add a 30-minute rescan for blocked posts in `fanpage-publish-due`.
- Update `update-post-schedule` to accept `privacySettings`.

### Phase 10 — Sports & Streamer Adapters (gated)

- Implement `sports_edit.ts` and `streamer_clip.ts` adapters with allowlists.
- Gate behind env presence. Frontend hides the radios when env is missing (read from diagnostics).

### Phase 11 — Tests, Smoke, Docs

- See §10. Add a `README` "FanAgent v2" section describing the library + calendar flow.

---

## 10. Testing / Acceptance Criteria

### 10.1 Unit Tests (`vitest`)

Add to `tests/`:

- `tests/fanagent.test.ts` (existing) — extend with:
  - `createPromptPlan` covers all six durations.
  - `buildSchedule` clamps quantity to 250 and cadence to 5..10080.
  - `normalizeSourceMode` accepts `sports_edit` and `streamer_clip`.
- `tests/sources.test.ts` (new):
  - `filterByDuration` returns the ±5s set when available; falls back to ±10s with `toleranceUsed=10`; returns empty when neither matches.
  - `filterPortrait` removes landscape candidates.
  - `selectUnique`:
    - `strict`: returns `reused=false` if a non-used candidate exists; returns `null` when all are used.
    - `allow_reuse_after_exhaustion`: returns `reused=true` on exhaustion.
    - `allow_reuse_freely`: returns first ranked candidate regardless of use.
  - Dedupe keys derived from `(provider, externalId)`, `origin_url`, and `perceptual_hash` (with Hamming ≤6 distance).
- `tests/library.test.ts` (new):
  - `library-schedule` rejects items with `status != 'ready'`.
  - `library-bulk-schedule` distributes 12 items across 2 daily windows with `maxPerDay=4` over 2 days.
  - `update-post-schedule` rejects edits when `status='posted'` and rejects past dates outside a 1-minute slack.
- `tests/publish.test.ts` (new):
  - `publish-tiktok-due` blocks (publish_status = `blocked_missing_privacy`) when `tiktok_privacy_level` is null.
  - blocks with `blocked_account_not_connected` when the access token decrypt throws "TikTok account is not connected".
  - retries with exponential backoff on 429.

### 10.2 Edge Function Dry-Run Fixtures

Add `supabase/functions/__fixtures__/`:

- `audio-clip.sample.json` — a 30s WAV (base64) and expected `audio_clip` row.
- `pexels.sample.json` — a mocked Pexels Videos response with portrait + landscape variants.
- `tiktok-creator-info.sample.json` — sample creator-info constraints.
- `tiktok-publish-status.sample.json` — sample status responses for `PUBLISH_COMPLETE`, `PROCESSING_UPLOAD`, `FAILED`.

Test harness: import fixtures into the relevant test files, monkey-patch `fetch` via `vi.spyOn(globalThis, 'fetch')`, and assert the function behavior.

### 10.3 Browser Smoke Tests

Add Playwright suite under `tests-e2e/` (new). The CI workflow can be optional — runs locally via `npm run test:e2e`:

- `e2e/upload.spec.ts` — uploads a sample MP3, selects 30s, confirms trim → `audio_clip` exists in DB.
- `e2e/lyrics.spec.ts` — after upload, the lyrics drawer opens, can edit a word, save template.
- `e2e/campaign.spec.ts` — submits a `quantity=2` `source_mode=stock` campaign, waits for two `video_library_items.ready` rows, asserts thumbnails and `provenance` field populated.
- `e2e/calendar.spec.ts` — drags a library tile onto Wednesday 17:00, post appears with correct `scheduled_at`; drag-reschedule to Thursday 09:00 works.
- `e2e/post-review.spec.ts` — opens post sheet, edits caption + privacy, saves; post row updates.

### 10.4 Acceptance Scenario (Codex must demonstrate)

1. **Setup**: env contains `PEXELS_API_KEY`, `FAL_KEY`, `ELEVENLABS_API_KEY`, `TIKTOK_*`, `CRON_SECRET`, `TOKEN_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. `pgcrypto`, `pg_cron`, `pg_net` enabled. Storage buckets created.
2. **Upload**: user uploads a 3-minute MP3 and trims to 30s.
3. **Transcribe + Template**: ElevenLabs returns ~50 words. Lyrics drawer opens; user edits 2 words and clicks Save Template.
4. **Campaign**: quantity 20, source_mode `stock`, prompt `"night-drive city lights"`, portraitOnly, avoidReuseWithinBatch.
5. **Generation**: within ≤ 30 minutes (cron-driven) the dashboard shows 20 `video_library_items` reaching `status='ready'` with **distinct** `(source_type, provider, external_id)` triples (or unique `perceptual_hash` for any reused fallbacks).
6. **Library**: `/library/:audioClipId` shows 20 tiles, each with a thumbnail, provenance line, "Schedule" button.
7. **Schedule**: user bulk-selects 20 tiles, picks "Cadence — every 4 hours starting tomorrow 09:00 PT". 20 `posts` rows are created with `status='pending', publish_status='ready'`.
8. **Calendar**: events appear; user drags one event to Friday 18:00 → DB shows updated `scheduled_at`.
9. **Publishing**:
   - If TikTok is connected: `fanpage-publish-due` posts the due ones, status becomes `posted` with TikTok URL.
   - If TikTok is NOT connected: posts move to `publish_status='blocked_account_not_connected'`, the calendar shows the orange-striped chip, and the side sheet's "Connect TikTok" button is one click away. No `posts.status='failed'` is emitted.
10. **Generation isolation**: regardless of step 9 outcome, the library remains intact — there is no rollback of library items because of publish problems.

### 10.5 Test Commands

- `npm run lint`
- `npm run test`
- `npm run test:e2e` (Playwright, optional in CI)
- `supabase functions serve` + `curl` smoke for each edge function.

---

## 11. Out of Scope

- Multi-tenant authentication (anon-user model preserved; per-user RLS hardening is a future phase).
- Cross-platform publishing beyond TikTok. The data model (`posts.privacy_settings jsonb`, future `posts.platform`) keeps the door open but no Instagram/YouTube adapters ship in this milestone.
- Anti-detection, ToS-evading automation, iPhone farms, headless-browser scraping, or unauthorized media ingest — explicitly forbidden by this spec.
- AI music generation. Audio remains user-uploaded.
- Real-time collaborative editing of templates (single-user UX only).
