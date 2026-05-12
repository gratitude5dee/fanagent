# Make the render pipeline actually finish a video

## What's broken (confirmed from DB + logs)

- All `provider: stock` items are getting picked up by `process-generation-due`, which always calls GMI Seedance and fails with `Missing required secret: GMI_API_KEY`. Every failure in `generation_items.error_message` is that string.
- There are **two overlapping orchestrators**: `process-generation-due` (GMI path) and `fanpage-generate-due` (fal.ai stock + ffmpeg path). The fal path has `FAL_KEY` and works, but it never runs end-to-end because:
  - `process-generation-due` keeps stealing items first.
  - `fanpage-generate-due` stops at `stitch-segments` and never creates a `posts` row, so nothing reaches publish.
- `render-karaoke` is currently a Remotion stub that's not invoked from the fal path at all, so lyrics templates aren't applied.
- `pending` items only get picked up when `scheduled_at <= now+1h` — current queue is at 16:01 UTC; that's fine, the worker just keeps failing on GMI.

## Fix scope

Single, fal.ai-only render path. Drop the GMI/Remotion code paths from the live pipeline (keep files; just stop using them).

## Edge function changes

1. **`process-generation-due`** — stop processing stock items.
   - Filter the `due` query to `provider in ('gmi_seedance','remote_render')` only. Items with `provider: stock` (the default for fanpage campaigns) are owned by `fanpage-generate-due`.
   - No other behavior change; this leaves the GMI path intact for anyone who configures `GMI_API_KEY` later.

2. **`render-karaoke`** — rewrite as fal.ai compose pass.
   - Inputs: `itemId`. Loads `generation_items.stock_clip_url` (the stitched output) + resolved `lyric_template_id`.
   - If no template: pass through (`status='ready'`, `render_provider='passthrough'`, copy stock_clip_url to post).
   - If template present:
     - Convert `lyric_blocks` → SRT string (per-word groups, snapped to `selection_start_ms`).
     - Build a fal `fal-ai/ffmpeg-api/compose` call with two tracks:
       - video keyframes split at `cut_markers` (re-cuts the same clip at marker boundaries for visual rhythm)
       - subtitle/text overlay via `drawtext` filter or a `subtitles` track using the SRT
     - Store final URL on `generation_items.final_asset_id` (after downloading + uploading via `createMediaAssetFromBytes`).
   - Set `render_provider='fal_ffmpeg'`, `status='ready'`.

3. **`fanpage-generate-due`** — extend the chain.
   - After `stitch-segments`, call `render-karaoke` for every item.
   - After `render-karaoke` succeeds, create the `posts` row (mirroring `createPostFromVideo` from `process-generation-due`): `final_asset_id`, `video_url`, caption/hashtags from `input_payload.prompt_plan`, `scheduled_at`, `status='pending'`, `publish_status='ready'`.
   - Mark item `status='complete'` and link `post_id`.

4. **`stitch-segments`** — small fix.
   - Stop updating `posts` directly (currently a no-op anyway since the post doesn't exist yet). Just write `stock_clip_url` and leave status as `stitched`.

5. **`_shared/fal.ts`** — add a helper that accepts an SRT URL or raw text and returns a composed video URL with subtitles burned in. Implementation: write SRT to a temporary signed URL via Supabase Storage `renders` bucket, then pass to fal compose's `subtitles` track.

## Frontend

No new UI. The Lyrics tab from the previous turn already lets users attach a template per batch/item; this just makes that template actually drive the render.

## DB

No schema changes. New status values reused: `stitched` (intermediate) and `ready` (final).

## What I'm NOT doing

- Not configuring `GMI_API_KEY`. The GMI path stays dormant unless the user adds the secret.
- Not touching Remotion SaaS dispatch or `REMOTION_RENDER_*` envs.
- Not changing the Autopilot UI.

## Verification

After deploy, the next `fanpage-generate-due` cron tick should:
- Move stock items through `transcribing → planning → stitched → ready`.
- Insert a `posts` row per item with `video_url` set.
- For items with a `lyric_template_id`, the rendered MP4 has captions burned in at the template's word timings + cut markers.

I'll re-query `generation_items` and `posts` after the change to confirm.

## Files touched

- `supabase/functions/process-generation-due/index.ts`
- `supabase/functions/render-karaoke/index.ts` (full rewrite)
- `supabase/functions/fanpage-generate-due/index.ts`
- `supabase/functions/stitch-segments/index.ts`
- `supabase/functions/_shared/fal.ts`
