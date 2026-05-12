# Fanpage Autopilot v2 — Variable Duration + AI Prompts + Mixed Sourcing

Extend the existing Autopilot flow into a 4-step wizard that supports variable post lengths, AI-generated video prompts, mixed stock/Seedance sourcing, ffmpeg stitching for >15s, and a TikTok auth gate before scheduling.

## Wizard Steps (frontend — `AutopilotPanel.tsx`)

**Step 1 — Upload audio + pick duration**
- Audio upload (existing) → `audio-uploads` bucket → `media_assets` row
- Duration selector: `15 / 30 / 45 / 60 / 75 / 90` seconds (chips)
- Post count + cadence (existing fields, kept)

**Step 2 — Generate template prompts**
- "Generate prompts" button → calls new edge function `generate-video-prompts`
- Shows N editable prompt cards (one per scheduled post). User can regenerate single prompts or edit text inline.
- Source mode toggle per batch: `stock` / `seedance` / `mixed` (default mixed)

**Step 3 — Preview & schedule**
- Lists the N planned posts with their prompt + source mode + stock preview (if stock) or "will generate" badge (if seedance)
- For each post, show planned segment count: `ceil(duration / 15)` clips to stitch
- "Schedule batch" inserts `generation_batches` + `generation_items`

**Step 4 — TikTok auth gate**
- Before any item can publish, check `accounts.tiktok_access_token_encrypted` is set on the primary account
- If not connected: show "Connect TikTok to start posting" CTA → existing `tiktok-oauth-callback` flow
- Once connected: batch flips from `paused` to `active` and cron picks it up

## Backend changes

### Database (migration)
- `generation_batches`: add `duration_seconds int not null default 15`, `source_mode` already exists (extend allowed values to `stock|seedance|mixed`)
- `generation_items`: add `segments jsonb` (array of `{source, url|prompt, start, end}`), `stitched_asset_id uuid`

### New edge function: `generate-video-prompts`
- Input: `{ batchId | { count, audioAssetId, durationSeconds, theme? } }`
- Calls Lovable AI Gateway (`google/gemini-3.1-flash-lite-preview`) via tool-calling to return `{ prompts: [{ text, mood, visual_style, suggested_source }] }`
- Persists prompts onto `generation_items.prompt` + `input_payload.prompt_meta`

### Updated: `pick-stock-clip`
- Honors `durationSeconds`. For `>15s`, picks `ceil(duration/15)` clips and writes them to `generation_items.segments`
- For `mixed` mode, randomly assigns each segment to `stock` or `seedance`

### New edge function: `generate-seedance-clip`
- For each `seedance` segment, submits a fal.ai Seedance 2 job (`fal-ai/bytedance/seedance/v2/lite/text-to-video`, 9:16, 5s)
- Stores returned URL in the segment

### New edge function: `stitch-segments`
- Triggered when all segments for an item have a URL
- Calls fal.ai ffmpeg-api compose (`fal-ai/ffmpeg-api/compose`) to concat segments + overlay the trimmed audio track
- Output URL → `media_assets` (bucket `renders`) → `generation_items.stitched_asset_id` + `final_asset_id`

### Updated: `fanpage-generate-due`
New per-item pipeline:
1. Ensure transcript (existing)
2. Plan segments (call `pick-stock-clip` with duration + mode)
3. For each `seedance` segment → `generate-seedance-clip`
4. When all segments ready → `stitch-segments` (skip if single 15s stock clip — pass through)
5. Mark item `ready_to_publish`

### Updated: `fanpage-publish-due`
- Hard-gate: if primary account has no TikTok token, skip and log `awaiting_tiktok_auth`
- Otherwise publish via existing TikTok Direct Post FILE_UPLOAD path

## Secrets
All required secrets already present (`FAL_KEY`, `LOVABLE_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, TikTok set). No new secrets needed.

## Out of scope (this sprint)
- Per-segment manual reroll UI (will add after pipeline is stable)
- Real-time progress stream (poll-based for v2)
- TikTok scraping as a stock source — using Pexels/Pixabay + Seedance only (TikTok TOS risk). Can revisit if you confirm.

## Open questions
1. **Mixed mode default ratio** — 50/50 stock:seedance, or weight toward stock (cheaper) by default?
2. **Seedance model tier** — `seedance/v2/lite` (fast, cheap) vs `seedance/v2/pro` (higher quality, ~5x cost)?
3. **TikTok scraping** — confirm dropping it, or do you want a "user-supplied TikTok URLs" input as a third source?
