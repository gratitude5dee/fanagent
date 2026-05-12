## Goal

Refactor the fal.ai integration in `supabase/functions/_shared/fal.ts` to expose every `fal-ai/ffmpeg-api/*` endpoint we need, and use the right one for each pipeline step instead of overloading `compose` for everything.

## Endpoints to wrap

In `_shared/fal.ts`, replace the current ad-hoc `falRun` usage with a typed helper per endpoint, all hitting `https://fal.run/<model>` (sync) with the existing `Authorization: Key ${FAL_KEY}` header:

1. `mergeVideos(urls)` → `fal-ai/ffmpeg-api/merge-videos`
2. `compose(tracks, opts?)` → `fal-ai/ffmpeg-api/compose` (multi-track timeline; keep current shape)
3. `mergeAudioVideo(videoUrl, audioUrl)` → `fal-ai/ffmpeg-api/merge-audio-video`
4. `extractFrame(videoUrl, position?)` → `fal-ai/ffmpeg-api/extract-frame` (for thumbnails)
5. `getMediaMetadata(fileUrl)` → `fal-ai/ffmpeg-api/metadata`
6. `mergeAudios(urls)` → `fal-ai/ffmpeg-api/merge-audios`
7. `loudnorm(audioUrl, opts?)` → `fal-ai/ffmpeg-api/loudnorm`
8. `waveform(audioUrl, opts?)` → `fal-ai/ffmpeg-api/waveform`

Each helper returns a normalized `{ url, raw }` (or `{ data }` for metadata/waveform). Keep existing `generateSeedanceClip`, `stitchClipsWithAudio`, `composeWithSubtitles` exports but reimplement them on top of the new primitives so callers don't break.

We will keep using the REST `fal.run` sync endpoint (already works in Deno). We will NOT pull in `@fal-ai/client` — the snippets in the user message are reference for the input shapes, not a runtime requirement; the npm client doesn't run cleanly in Supabase edge runtime.

## Wire into pipeline

- `stitch-segments/index.ts`:
  - When there's a single segment URL and no markers and no audio overlay needed → keep passthrough.
  - When stitching pure video clips with no audio mix → use `mergeVideos`.
  - When overlaying the batch audio on the stitched video → call `mergeVideos` first, then `mergeAudioVideo`, instead of building a `compose` timeline. Fall back to `compose` only when per-segment durations differ from the source clip lengths (marker-driven trims).
- `render-karaoke/index.ts`: keep `composeWithSubtitles` (compose is the only endpoint that supports a subtitles track).
- New optional helper: after `render-karaoke` succeeds, call `extractFrame(finalUrl, "middle")` and store the PNG as the post thumbnail on `media_assets.metadata.thumbnail_url`. (Behind a flag; don't block the pipeline if it fails.)

## Files to touch

- `supabase/functions/_shared/fal.ts` — add the 8 helpers, refactor existing exports to reuse them.
- `supabase/functions/stitch-segments/index.ts` — branch to `mergeVideos` + `mergeAudioVideo` when possible.
- `supabase/functions/render-karaoke/index.ts` — optional thumbnail via `extractFrame`.

No DB schema, secrets, or frontend changes. `FAL_KEY` is already configured.

## Validation

1. Deploy `stitch-segments`, `render-karaoke`.
2. Run `pick-stock-clip` → `stitch-segments` → `render-karaoke` for one stuck `generation_items` row via `curl_edge_functions` and confirm:
   - `stitch-segments` returns a playable URL.
   - `render-karaoke` produces a `rendered_video` `media_asset` and the item moves to `ready`.
3. Tail `edge_function_logs` for either function to confirm the new fal calls succeed (HTTP 200, non-empty `video_url`).
