## Goal

Make the play button (and overall audio UX) in `/lyrics/new` and `/lyrics/:id` actually play the trimmed clip, in every panel, every time — for both freshly uploaded and resumed templates.

## Root causes observed

1. **`AudioPanel`, `MarkersPanel`, `LyricsPanel` each instantiate their own `<audio>` tag** and roll their own `play()` / RAF code. The `<audio>` element only renders when `audioUrl` is truthy, so when the signed URL hasn't (yet) been resolved, the play button is a silent no-op. There's no error surfaced, no readiness gate, no retry.
2. **`signedUrlForTemplate` runs once on mount only.** If it fails (expired URL, missing row), the wizard stays without audio forever — the user clicks Play, nothing happens.
3. **No `play()` rejection handling**: `audio.play().catch(() => {})` swallows autoplay/CORS errors silently. No toast, no console.
4. **Loop / clip-window logic is duplicated** in `AudioPanel.preview()` and missing in `MarkersPanel` (markers play the full file, not the trimmed clip window).
5. The screenshot also shows the Audio column collapsed back to the dropzone on a resumed template — `AudioPanel` only restores file/url state from `existingAudioUrl`, which is null when signed-URL hydration silently failed.

## Plan

### 1. Introduce `src/lib/lyrics/useAudioEngine.ts` (new)

Port the brief's `useAudioEngine` hook verbatim (single shared `HTMLAudioElement`, loop window, RAF tick, `load/play/pause/toggle/seek/setLoop`, sonner toast on error). Clip-relative `currentTime`. Returns `{ isReady, isPlaying, currentTime, duration, load, play, pause, toggle, seek, setLoop }`.

### 2. Hoist the engine into `LyricsTemplateBuilder`

- Create one `engine = useAudioEngine()` instance in the builder and pass it down to `AudioPanel`, `LyricsPanel`, `MarkersPanel` as a prop.
- Drop the per-panel `<audio>` tags, `audioRef`, and bespoke `timeupdate` / RAF logic.
- When `trimmedAudioUrl` changes → `engine.load(url)` and `engine.setLoop(0, selection_duration_ms/1000, { loop: true })` (trimmed clip is the whole window, so start=0).
- For the upload preview in `AudioPanel` (raw, untrimmed file via `URL.createObjectURL`), `engine.load(blobUrl)` then `engine.setLoop(start, start+duration)`.

### 3. Reliable signed-URL hydration

`signedUrlForTemplate` becomes a hook `useTrimmedAudioUrl(template)`:
- Resolves the `project_assets` row, calls `createSignedUrl(path, 3600)`.
- On failure: `toast.error("Couldn't load trimmed audio")` + log, and exposes a `retry()` callback.
- Re-runs when `template.trimmed_audio_asset_id` changes (covers the `createFromAudioClip` repair path).
- Refreshes the URL ~10 min before expiry via a timer.

### 4. Update each panel to consume the engine

- **AudioPanel**: replace `preview()` with `engine.toggle()`. When the selection window changes, call `engine.setLoop(start, start+duration)`. Show `engine.isReady` state (disable Preview until ready).
- **LyricsPanel**: mini player uses `engine.toggle()` and reads `engine.currentTime` for the progress bar.
- **MarkersPanel**: `togglePlay` → `engine.toggle()`, `restart` → `engine.seek(0)`, `time` state comes from `engine.currentTime`. Loop is the full trimmed clip. Add explicit "Audio loading…" placeholder when `!engine.isReady`.

### 5. Surface errors instead of swallowing them

- Engine's `onError` already shows a sonner toast (with `MediaError.code`).
- Awaited `engine.play()` rejections logged + toasted (covers autoplay-blocked, decode errors, CORS).
- Add a one-time `console.info` of the signed URL on first load (dev only) to make debugging trivial.

### 6. Tests (vitest)

- Add `tests/use-audio-engine.test.ts` covering: `setLoop` clamps `currentTime`, `seek` clamps to clip range, `load(null)` releases src.
- Smoke test: `MarkersPanel` renders with a stubbed engine prop and the play button calls `engine.toggle`.

### Files touched

- new: `src/lib/lyrics/useAudioEngine.ts`, `src/lib/lyrics/useTrimmedAudioUrl.ts`, `tests/use-audio-engine.test.ts`
- edit: `src/components/autopilot/LyricsTemplateBuilder.tsx`, `src/pages/lyrics/panels/AudioPanel.tsx`, `src/pages/lyrics/panels/LyricsPanel.tsx`, `src/pages/lyrics/panels/MarkersPanel.tsx`

### Out of scope (deferred)

- Remotion `<Player>` preview, the full `/kanvas/remix` route, `remix_jobs` / `remix_renders` tables, server-side render worker, lyric-style presets, export modal. (Brief sections 8–11.) The current sprint reuses the existing seedance/stock pipeline as agreed; this fix is strictly about making the **template wizard's audio playback** fully functional.

Confirm and I'll implement.