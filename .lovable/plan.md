## Fanpage Autopilot — Final Plan

Builds the autopilot lane on the existing `fanagent` codebase. **Renderer**: hosted Remotion SaaS (single API key — `REMOTION_RENDER_API_KEY` + `REMOTION_RENDER_ENDPOINT`). **OAuth**: extend the existing `tiktok-oauth-callback` rather than fork.

### Phase 1 — DB + storage

1. Apply pending migration `20260510161218_fanagent_core.sql` (source of every dashboard `PGRST205`).
2. New migration adds:
   - `accounts.is_primary boolean` (V1: one TikTok account per user, partial unique index).
   - `accounts.creator_info jsonb`, `accounts.encrypted_access_token`, `encrypted_refresh_token`, `token_expires_at`.
   - `generation_batches.next_run_at timestamptz`, `paused_at timestamptz`.
   - `generation_items.stock_clip_url`, `render_provider`, `render_job_id`, `render_callback_token`.
   - `media_assets.transcript jsonb` (Scribe v2 word array + language).
   - New tables: `publish_attempts` (post_id, tiktok_publish_id, status, error, raw_response), `worker_runs` (function, started/ended, items, errors).
3. Storage buckets (private, signed URLs): `audio-uploads`, `stock-cache`, `renders`. RLS scoped to `auth.uid()`.
4. Enable `pg_cron` + `pg_net`. Add `CRON_SECRET` runtime secret.

### Phase 2 — Stock source layer

`supabase/functions/_shared/stock.ts` exposes `searchStock({query, durationSec, aspect, count})` over three providers behind one ranker:
- **User library** — `media_assets` where `kind='video'`, `source='upload'`.
- **Pexels Videos** (`PEXELS_API_KEY`).
- **Pixabay Videos** (`PIXABAY_API_KEY`).
- **fal.ai stock** (`FAL_KEY`, also reused for Seedance fallback).

Caches downloaded MP4s into `stock-cache` bucket so repeat picks don't re-fetch.

### Phase 3 — Scribe v2 transcription

New edge function `transcribe-audio`:
- Pulls audio from `audio-uploads` → POSTs to ElevenLabs `scribe_v2` (multipart, no diarize).
- Persists `{words:[{text,start,end,confidence}], language}` into `media_assets.transcript`.
- Auto-invoked at the end of `create-generation-batch`. Idempotent.

### Phase 4 — Remotion karaoke composition

`remotion/` project (sibling to `supabase/`):
- `KaraokeFanpage.tsx` — composition props `{ audioUrl, stockClipUrl, transcript, durationFrames=450, fps=30 }` (15s × 30fps).
- TikTok-style word-by-word karaoke: active word scaled + accent color, prior dim, next muted; safe-area padded; cut flash on word boundaries.
- `Root.tsx` registers it; bundle is uploaded to the hosted Remotion service once and pinned by `REMOTION_SERVE_URL`.

### Phase 5 — Render pipeline (hosted SaaS)

`render-karaoke` edge function:
- POSTs `{ serveUrl, composition: 'KaraokeFanpage', inputProps, webhook }` to `REMOTION_RENDER_ENDPOINT` with `Authorization: Bearer ${REMOTION_RENDER_API_KEY}`.
- Stores returned job id into `generation_items.render_job_id`, sets status `rendering`.

`render-callback` edge function (no JWT, signed by `render_callback_token`):
- Receives webhook with final MP4 URL.
- Streams MP4 into the `renders` bucket → sets `generation_items.video_url` + status `ready`.

### Phase 6 — Workers

- `fanpage-campaign` (auth via Supabase JWT) — wraps `create-generation-batch`; adds `list`, `pause`, `resume`, `updateSchedule`, `skipPost`, `regeneratePost`.
- `fanpage-generate-due` (accepts `x-cron-secret`) — replaces `process-generation-due`. For each due item: `stock` → `pick-stock-clip` → `render-karaoke`; `seedance` → existing GMI → `render-karaoke`; `hybrid` → stock first, fall back. Writes `worker_runs`.
- `fanpage-publish-due` (accepts `x-cron-secret`) — wraps `publish-tiktok-due`; uses Direct Post `FILE_UPLOAD` builders from `src/lib/fanagent/tiktok.ts`. Writes `publish_attempts`.
- `tiktok-oauth-callback` (extended) — capture `creator_info`, encrypt + store tokens via `_shared/crypto.ts`, mark `accounts.is_primary=true`.

### Phase 7 — Cron (insert, not migration)

```sql
select cron.schedule('fanpage-generate-due','*/5 * * * *', $$
  select net.http_post(
    url:='https://zjbiulirzrctfmakqjwk.supabase.co/functions/v1/fanpage-generate-due',
    headers:='{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
    body:='{}'::jsonb);
$$);
select cron.schedule('fanpage-publish-due','*/5 * * * *', ... );
```

### Phase 8 — Frontend

A new `/autopilot` route with a 4-step wizard (Connect TikTok → Upload audio → Source mode + cadence → Confirm), then a queue/calendar view (reuse `FanAgentCalendar.tsx`) with pause/skip/regenerate, transcription + render status badges, and a `@remotion/player` preview.

### Secrets to request after approval

`ELEVENLABS_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `FAL_KEY`, `CRON_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `REMOTION_RENDER_API_KEY`, `REMOTION_RENDER_ENDPOINT`, `REMOTION_SERVE_URL`, plus a `TOKEN_ENCRYPTION_KEY` if not already present.
