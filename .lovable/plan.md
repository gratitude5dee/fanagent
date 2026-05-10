## Fanpage Autopilot — Implementation Plan (v2)

Builds the autopilot lane on the existing `fanagent` codebase. Reuses `create-generation-batch`, `process-generation-due`, `publish-tiktok-due`, `tiktok-oauth-callback`, and the GMI Seedance helpers. Adds stock-first generation, ElevenLabs Scribe v2 word-timed transcription, Remotion karaoke composition, and cron-driven daily publishing.

### Phase 1 — Apply pending DB migration + storage

1. Apply `supabase/migrations/20260510161218_fanagent_core.sql` (currently unapplied — source of every `PGRST205` in the dashboard).
2. New migration adds:
   - `accounts.is_primary boolean` (V1 enforces one TikTok account per user).
   - `generation_batches.cadence = 'daily'` default + `next_run_at timestamptz`.
   - `generation_items.stock_clip_url`, `render_job_id`, `render_provider`, `transcript_id` columns.
   - `media_assets.transcript jsonb` (Scribe v2 word array).
   - `publish_attempts` table (TikTok publish_id, status, error, raw response).
   - `worker_runs` table (run_id, function name, started/ended, items processed, errors).
3. Storage buckets (private, signed URLs): `audio-uploads`, `stock-cache`, `renders`. RLS scoped to `auth.uid()`.
4. Enable `pg_cron` + `pg_net`. Add `CRON_SECRET` runtime secret.

### Phase 2 — Stock source layer (default)

`supabase/functions/_shared/stock.ts` exposes `searchStock({query, durationSec, aspect, count})` with three providers:
- **User library** — `media_assets` where `kind='video'`, `source='upload'`.
- **Pexels Videos** (`PEXELS_API_KEY`).
- **Pixabay Videos** (`PIXABAY_API_KEY`).
- **fal.ai stock search** (`FAL_KEY`, also reused for Seedance fallback).

Ranks by duration ≥ 15s, vertical-friendly aspect, query relevance. Caches downloaded MP4s into `stock-cache` bucket so repeat picks don't re-fetch.

### Phase 3 — Scribe v2 transcription

New edge function `transcribe-audio`:
- Pulls audio from `audio-uploads` bucket → POSTs to ElevenLabs `scribe_v2` (multipart, no diarize).
- Persists `{words:[{text,start,end,confidence}], language}` to `media_assets.transcript`.
- Auto-invoked at the end of `create-generation-batch` once the audio asset is registered.
- Idempotent: skips if `transcript` already populated.

### Phase 4 — Remotion karaoke composition

`remotion/` project (sibling to `supabase/`):
- `KaraokeFanpage.tsx` — composition props: `{ audioUrl, stockClipUrl, transcript, durationFrames=450, fps=30 }` (15s × 30fps).
- TikTok-style word-by-word: active word scaled + accent color, prior dim, next muted; safe-area padded for TikTok UI overlays; cut flash on every Nth word boundary.
- `Root.tsx` registers it; `scripts/render.mjs` is the programmatic render entry (per the remotion-video skill: `chromeMode: "chrome-for-testing"`, `muted: true`, compositor symlink fix for NixOS).
- Versioned in repo so re-renders are deterministic.

### Phase 5 — Render host (DECISION REQUIRED — pick one)

`render-karaoke` edge function dispatches the job and writes `generation_items.render_job_id`. Options:

- **A. Remotion Lambda** (recommended) — fastest, ~1¢/15s render. One-time `npx remotion lambda sites create` + `functions deploy`. Needs `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `REMOTION_LAMBDA_FUNCTION_NAME`, `REMOTION_SERVE_URL`.
- **B. Cloud Run job** — single GCP service-account JSON; runs `@remotion/renderer` headless.
- **C. Hosted Remotion-as-a-Service** (nodes.studio / remotion.pro) — single API key, no infra.

Webhook back to `render-callback` edge function → uploads MP4 to `renders` bucket → sets `generation_items.video_url` + status `ready`.

QCut is excluded — it's a browser editor, not a render service, and breaks autopilot.

### Phase 6 — Worker rewiring + new edge functions

Rename / add:
- `fanpage-campaign` — wraps current `create-generation-batch`; adds `listCampaigns`, `pauseCampaign`, `resumeCampaign`, `updateSchedule`, `skipPost`, `regeneratePost`. Auth via Supabase JWT.
- `fanpage-generate-due` — replaces / wraps `process-generation-due`. For each due item: `stock` → `pick-stock-clip` → `render-karaoke`; `seedance` → existing GMI path → `render-karaoke` overlay; `hybrid` → stock first, fall back if no candidate ≥ confidence threshold. Accepts `x-cron-secret`.
- `fanpage-publish-due` — wraps current `publish-tiktok-due`; uses TikTok Direct Post `FILE_UPLOAD` chunked init from `src/lib/fanagent/tiktok.ts`. Writes `publish_attempts`. Accepts `x-cron-secret`.
- `fanpage-tiktok-oauth-callback` — current `tiktok-oauth-callback` extended to capture `creator_info` and store encrypted tokens (already partially present via `_shared/crypto.ts`).
- `transcribe-audio`, `pick-stock-clip`, `render-karaoke`, `render-callback` — new.

### Phase 7 — Cron

Insert (not migration — contains URL + anon key):
```sql
select cron.schedule('fanpage-generate-due', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://zjbiulirzrctfmakqjwk.supabase.co/functions/v1/fanpage-generate-due',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
select cron.schedule('fanpage-publish-due', '*/5 * * * *', ...);
```

### Phase 8 — Frontend lane

A new `/autopilot` route with a 4-step setup wizard (Connect TikTok → Upload audio → Choose source mode + cadence → Confirm), then a queue/calendar view (reuse `FanAgentCalendar.tsx`) with pause/skip/regenerate, transcription + render status badges, and a `@remotion/player` preview. Existing Kanvas pages remain untouched.

### Secrets to request after approval

`ELEVENLABS_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `FAL_KEY`, `CRON_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, plus host credentials per Phase 5 choice.

### Open question (blocking)

**Which render host: A (Remotion Lambda), B (Cloud Run), or C (hosted SaaS)?**
