# Lyrics Template Builder

Standalone tool at `/lyrics`. Doesn't touch Autopilot for now — it produces reusable lyric+marker templates that we'll wire into the render pipeline in a later sprint.

## Routing

Add `react-router-dom`. App.tsx becomes a `<BrowserRouter>` shell:

- `/` → existing Autopilot/Studio toggle (current `App` content moves into a `Home` page)
- `/lyrics` → templates landing
- `/lyrics/new` → wizard (creates a new template, then redirects to `/lyrics/templates/:id`)
- `/lyrics/templates/:templateId` → wizard hydrated from the row, supports continue/edit

A nav link is added to the existing top tab bar so users can reach Lyrics.

## Database (one migration)

`project_assets`
- user_id (uuid, not null)
- kind: 'audio' | 'audio_trimmed'
- storage_bucket, storage_path, public_url, file_name, mime_type, byte_size, duration_ms
- metadata jsonb

`kanvas_lyric_templates`
- user_id, title, status (`draft | audio_ready | lyrics_processing | lyrics_ready | markers_ready | saved | failed | archived`)
- source_audio_asset_id, trimmed_audio_asset_id (nullable fks → project_assets)
- selection_start_ms, selection_duration_ms, total_duration_ms
- waveform_peaks jsonb (number[])
- lyric_blocks jsonb (LyricBlock[])
- cut_markers jsonb (number[] in ms)
- transcript_meta jsonb (provider, model, raw counts)
- render_defaults jsonb
- error_message text, saved_at, archived_at

`kanvas_lyric_template_jobs`
- template_id, user_id, kind ('transcribe'), status, provider, error_message, started_at, finished_at, response jsonb

Storage bucket: reuse private `audio-uploads` under path `lyric-templates/{userId}/{templateId}/...`.

RLS on both tables: owner-only select/insert/update/delete via `auth.uid() = user_id`. No cross-user reads.

## Edge functions

1. `kanvas-lyrics-audio-register` — POST `{ storagePath, mimeType, fileName, byteSize, durationMs }`. Verifies the object exists in `audio-uploads`, signs a URL, inserts a `project_assets` row owned by the caller. Returns the asset.

2. `kanvas-lyrics-template` — POST action API:
   - `create` → inserts row in `draft`
   - `get` → row by id (RLS enforces ownership)
   - `list` → user's templates
   - `patch` → partial update (selection, peaks, lyric_blocks, cut_markers, status, title)
   - `finalize` → set status `saved`, `saved_at = now()`
   - `archive` → set `archived`, `archived_at = now()`

3. `kanvas-lyrics-transcribe` — POST `{ templateId, force? }`. Loads template, marks `lyrics_processing`, inserts job row, calls **GMI Cloud Gemini audio model** with the trimmed audio's signed URL, converts segments → `LyricBlock[]` with word-level timing, writes `lyric_blocks` + `transcript_meta`, sets `lyrics_ready`. Catches errors → status `failed`, returns 200 with error so the UI can fall back to manual entry.

Secret needed: **`GMI_CLOUD_API_KEY`** — added on user confirm.

## Frontend layout

`src/pages/lyrics/`
- `LyricsLanding.tsx` — header, hero, search + filter chips, preset tiles, template card grid, "How it works"
- `LyricsWizard.tsx` — header, three-panel grid (Audio / Lyrics / Cut Markers), bottom footer (stepper + duration + word count + Save), saving overlay, floating help

`src/pages/lyrics/panels/`
- `AudioPanel.tsx` — dropzone, waveform (canvas, decoded peaks via Web Audio API), draggable selection, 15/30/45/60 buttons, zoom slider, loop preview, Confirm
- `LyricsPanel.tsx` — locked overlay + processing states + ready editor (word pills, mini-player, active-word highlight) + manual-entry fallback
- `MarkersPanel.tsx` — 16:9 visualizer stage (active word in yellow uppercase, CUT flash), waveform with draggable markers, controls, undo/redo (30 states), keyboard shortcuts, snap/dedupe rules

`src/lib/lyrics/`
- `types.ts` — types from the spec verbatim (sec on UI side)
- `audio.ts` — decode peaks (`AudioContext.decodeAudioData`), client-side WAV slice via `OfflineAudioContext`, deterministic fallback peaks
- `api.ts` — typed wrappers around the three edge functions, with sec↔ms conversion at the boundary
- `markers.ts` — snap (0.05s), dedupe (0.25s), delete-nearest (0.5s), undo stack
- `state.ts` — small reducer/store (`zustand` already absent — use plain `useReducer` to avoid new deps)

## Design system

Add scoped lyrics theme tokens to `index.css` (`--lyrics-bg #050506`, `--lyrics-panel #11131A`, `--lyrics-wave #0B0E14`, `--lyrics-orange #f97316`, `--lyrics-orange-2 #fb923c`, `--lyrics-cyan #22d3ee`, emerald success). The lyrics routes wrap content in a `.lyrics-root` class so the dark theme stays scoped and doesn't leak into Autopilot/Studio.

Use existing shadcn primitives (Button, Input, Slider, Dialog, Tabs) styled via CSS variables — no new component library.

## Tests

`tests/lyrics.test.ts`:
- `/lyrics` landing renders create CTA + duration policy
- `/lyrics/new` renders three panels
- Save disabled until `confirmed && lyric_blocks.length > 0`
- Audio validation: rejects unsupported mime + >50MB
- Markers: snap/dedupe/delete/undo/redo
- Status → wizard step mapping
- ms↔sec conversion at API boundary

## Out of scope (this sprint)

- Wiring lyrics templates into Autopilot's render pipeline
- Real-time collaborative editing
- Server-side audio decoding (peaks always computed client-side)
- Remix/clone of saved templates (button is a stub)

## Acceptance

1. Open `/lyrics` → landing renders, "Create new template" goes to `/lyrics/new`.
2. Upload MP3 ≤50MB → waveform decodes, default 15s selection, can drag/zoom/loop preview.
3. Confirm → selection sliced client-side, uploaded, template row created, redirected to `/lyrics/templates/:id`.
4. Transcription runs via GMI Cloud; on failure, manual entry path works.
5. Edit word pills (click/Enter/Esc/blur).
6. Markers: M adds, drag moves, click deletes, undo/redo work, snap to 0.05s, dedupe inside 0.25s.
7. Save → `saved` status, returns to landing, card shows in list.
8. Refresh on `/lyrics/templates/:id` → wizard hydrates to the correct step.

## Action item for the user (after approval)

I'll request **`GMI_CLOUD_API_KEY`** via the secrets prompt; the rest is automatic.
