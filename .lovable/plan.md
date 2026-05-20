## Goal
Make saved lyric templates carry their audio end-to-end, remove the fallback that asks for a new upload when reusing a template, and restore fully functional synced playback in the Lyrics and Cut Markers steps.

## What I’ll implement

### 1. Repair template audio persistence
- Update the lyrics audio upload/register flow to use one consistent storage contract for template audio instead of the current mixed `audio-uploads` / `lyric-templates/...` path.
- Align the client and edge function with the intended template asset model so a template always ends with a durable trimmed audio asset reference.
- Ensure template creation stores enough source/trimmed asset metadata for later retrieval, reopening, and remix generation.
- Harden the template edge function so `get`, `patch`, `finalize`, and `signTrimmedAudio` continue to work even for older or partially-created rows.

### 2. Restore wizard playback + sync
- Keep one shared audio engine for the 3-step wizard and make sure it always loads the correct clip on first open and on template reload.
- Reset and clamp playback correctly when switching templates, confirming audio, reopening saved templates, or retrying signed URLs.
- Make the Lyrics panel reliably follow playback with active-word highlighting, active-line emphasis, seeking from words, and synced progress.
- Make the Cut Markers panel show the current lyric line instead of a static placeholder, with live word-state changes tied to the playhead.
- Preserve marker editing behavior while making scrubbing, restart, play/pause, undo/redo, and delete-nearest operate against the same active clip.

### 3. Unify remix template reuse
- Change Remix to resolve audio through the same signed template-audio path as the wizard instead of direct browser-side `project_assets` reads.
- Make generation launch from a saved template without needing fresh audio input by ensuring the finalized template always exposes an `audio_clip_id` or equivalent reusable audio reference.
- Remove the conditions that cause saved-template reuse to fall back to “upload file first” behavior.

### 4. Validate the broken paths
- Verify these flows after implementation:
  - create new template → confirm audio → transcribe → markers → save
  - reopen template from landing → audio plays immediately
  - saved template → remix page loads audio without prompting for upload
  - lyrics highlight and marker stage stay synced during playback

## Files likely to change
- `src/pages/lyrics/panels/AudioPanel.tsx`
- `src/pages/lyrics/panels/LyricsPanel.tsx`
- `src/pages/lyrics/panels/MarkersPanel.tsx`
- `src/components/autopilot/LyricsTemplateBuilder.tsx`
- `src/pages/lyrics/RemixEditor.tsx`
- `src/lib/lyrics/api.ts`
- `src/lib/lyrics/useTrimmedAudioUrl.ts`
- `supabase/functions/kanvas-lyrics-audio-register/index.ts`
- `supabase/functions/kanvas-lyrics-template/index.ts`
- `src/styles.css`

## Technical details
- The current implementation is off-contract in a few places:
  - trimmed template audio is uploaded to `audio-uploads` with a `lyric-templates/...` path instead of the intended user-scoped template audio path
  - the register function currently accepts that looser shape, which makes retrieval and ownership assumptions inconsistent
  - remix still loads template audio by querying `project_assets` from the browser, which is fragile under RLS and mismatched ownership
- I’ll fix this by making the template asset flow internally consistent rather than layering more fallbacks on top.
- I won’t expand scope into redesigning the full `/kanvas/*` route architecture yet; this pass will focus on getting the current lyrics/template/remix surfaces fully functional.