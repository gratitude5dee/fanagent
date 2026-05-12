# Audio waveform + trim for Autopilot Step 1

## Goal

When a user uploads audio in the Autopilot wizard, show a dark waveform card matching the reference screenshot (vertical bars, scrubber, play / skip-back / skip-forward buttons, draggable trim handles). The user trims to the segment they want, we render that slice client-side with `ffmpeg.wasm`, and only the trimmed file is uploaded to the `audio-uploads` bucket as the campaign's master audio.

The Remotion karaoke render stub stays in place — no backend changes to `render-karaoke`.

## Stock-footage clarification (no code change, just doc)

Add a one-paragraph note in `AutopilotPanel` near the source-mode toggle explaining: stock footage = Pexels + Pixabay + your own library, picked for portrait aspect, cached in the private `stock-cache` bucket. "Remote render" = the optional Remotion karaoke step (currently a pass-through stub).

## UX (Step 1)

```text
┌─ ♪ Audio ──────────────────────────────────────────────┐
│                                                        │
│   ▁▂▅█▇▅▂▁  ▂▅█▇▅▂▁ │ ▂▅█▇▅▂▁  ▁▂▅█▇▅▂▁              │
│   └──── trim L ─────┴──── trim R ────┘                 │
│                                                        │
│              ⏪    ▶    ⏩       0:12 / 0:47           │
│                                                        │
│   Selected: 0:08 → 0:23  (15s)   [Use this clip]       │
└────────────────────────────────────────────────────────┘
```

- Drop-zone first; once a file is chosen, swap to the waveform card.
- Two draggable handles define `[startSec, endSec]`.
- Selected length is auto-clamped to the duration the user picked in the duration selector (15/30/45/60/75/90s). If the source is shorter than the selected duration, show an inline warning and disable "Use this clip".
- Play button only plays the selected region (loops within handles). Skip-back / skip-forward jump ±5s within the selection.
- "Use this clip" → render the trim with `ffmpeg.wasm` → upload to `audio-uploads/{accountId}/{uuid}.mp3` → insert `media_assets` row → store `audio_asset_id` on the wizard state.

## Technical details

### New deps
- `wavesurfer.js` (~40KB) — waveform + region plugin handles trim handles natively (`wavesurfer.js/dist/plugins/regions`).
- `@ffmpeg/ffmpeg` + `@ffmpeg/util` — client-side trim. Loaded lazily on first trim to keep initial bundle small. Core files served from unpkg CDN (no need to host the ~25MB wasm ourselves).

### New file: `src/components/autopilot/AudioTrimmer.tsx`
- Props: `file: File`, `maxDurationSec: number`, `onTrimmed(blob: Blob, durationSec: number): void`.
- Internal state: `region: { start, end }`, `isPlaying`, `isProcessing`.
- Uses `WaveSurfer.create({ container, waveColor, progressColor, barWidth: 3, barGap: 2, barRadius: 3, height: 140, cursorColor })` styled with semantic tokens (`--muted-foreground` for waveColor, `--primary` for progressColor + cursor).
- Region plugin: single region, draggable, resizable, clamped to `[0, duration]` and length `<= maxDurationSec`.
- Custom controls row (skip-back / play / skip-forward) using existing shadcn `Button` + `lucide-react` icons.
- On "Use this clip": calls a small helper `trimAudio(file, start, end)` that runs ffmpeg.wasm with `-ss {start} -to {end} -c copy` (falls back to re-encode if container needs it), returns a `Blob`.

### New file: `src/lib/audio/ffmpeg.ts`
- Singleton `getFFmpeg()` that lazy-loads ffmpeg.wasm from unpkg the first time.
- Exports `trimAudio(file, startSec, endSec): Promise<Blob>`.

### Edit: `src/components/AutopilotPanel.tsx`
- Replace the current plain `<input type="file" accept="audio/*">` block in Step 1 with: input → on file selection, mount `<AudioTrimmer>`.
- After `onTrimmed`, run the existing upload-to-storage + `media_assets` insert flow with the trimmed `Blob` (was the raw `File` before).
- Add the short stock-footage explainer paragraph under the source-mode toggle.

### Vite config
- Add `optimizeDeps.exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']` so Vite doesn't try to pre-bundle the wasm-loading code.
- Add the COOP/COEP headers needed by SharedArrayBuffer in dev: `server.headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }`. (Production preview already serves these correctly for static assets.)

### No backend changes
- `audio-uploads` bucket already exists.
- `media_assets` insert path is unchanged — we just hand it a trimmed blob instead of the raw file.
- `generation_batches.audio_asset_id` already points at the master audio; downstream stitcher already overlays it as-is, so no trim metadata needs to live server-side.
- `render-karaoke` stub left untouched per your choice.

## Out of scope
- Multi-region trimming (only one selection).
- Server-side fallback trim (we commit to ffmpeg.wasm; if it fails to load we show an error with a "Use full clip" escape hatch).
- Waveform colour theming beyond the existing dark palette.

## Acceptance
1. Upload an audio file → waveform renders within ~1s.
2. Dragging handles updates the "Selected" readout live; cannot exceed the chosen duration.
3. Play button plays only the selected region.
4. "Use this clip" produces a trimmed file whose duration matches the selection ±0.1s, visible as the new `media_assets` row.
5. Wizard advances to Step 2 with the trimmed asset attached.
