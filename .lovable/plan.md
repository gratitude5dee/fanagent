## Goal
Make the lyric template wizard reliable end-to-end so saved templates keep their audio, lyrics generation consistently reaches a usable state, and the Lyrics/Cut Markers panels stay in sync with playback.

## What’s actually broken
- Some older template rows are missing `trimmed_audio_asset_id`, which triggers the “please upload file” fallback even when the template already has lyrics.
- The backend contract is inconsistent across template creation/reopen flows: the newest template signs audio correctly, but legacy/incomplete templates are not always self-healed before the UI renders.
- The lyrics step does not robustly recover from `audio_ready` / `lyrics_processing` / `failed` states when reopening a template, so generation can appear stuck.
- The cut markers step depends on the shared audio engine and lyric blocks being hydrated in the right order; when either is stale, playback/highlighting looks broken.

## Implementation plan
### 1) Harden template audio recovery
- Update the lyric template fetch/reopen path so any template missing `trimmed_audio_asset_id` is repaired from linked metadata before the wizard tries to render playback.
- Make the edge function’s `get`/`signTrimmedAudio` paths use the same repair rules, so the browser never has to guess whether audio exists.
- Keep the current signed-URL approach and remove any remaining UI assumptions that a missing `trimmed_audio_asset_id` means the user must re-upload.

### 2) Make lyrics generation stateful and recoverable
- Update the wizard to explicitly handle these states on load: `draft`, `audio_ready`, `lyrics_processing`, `failed`, `lyrics_ready`, `saved`.
- If a template is `audio_ready` with valid trimmed audio but no lyric blocks, trigger transcription instead of leaving the panel in a passive waiting state.
- If transcription is already in progress, poll/refetch the template until it reaches `lyrics_ready` or `failed` so the UI updates without a manual reload.
- Surface backend failure messages cleanly inside the lyrics panel and keep manual entry as the fallback.

### 3) Stabilize synced playback in Lyrics + Cut Markers
- Unify active-word/active-line resolution so both panels use the same playhead interpretation and the same fallback behavior before the first word and between lines.
- Ensure the audio engine resets and loop bounds are applied consistently when opening a saved template, switching steps, retrying transcription, or replaying from the start.
- Make the marker stage render the current/next lyric line deterministically even at `t=0` and during scrubbing.

### 4) Fix cut marker editing flow
- Make marker changes persist reliably and reflect immediately after add/move/delete/undo/redo.
- Verify marker dragging commits the moved value, not stale pre-drag state.
- Keep the karaoke preview and playhead aligned while scrubbing so users can place cuts against the visible lyric timing.

### 5) Validate against the live contract
- Test a brand-new template flow: upload → confirm audio → generate lyrics → preview synced highlighting → add markers → save.
- Test reopening the newest template and an older broken template to confirm audio no longer asks for re-upload.
- Verify the Remix page still loads template audio via signed URL after the wizard fixes.

## Technical details
- Likely files: `src/components/autopilot/LyricsTemplateBuilder.tsx`, `src/pages/lyrics/panels/AudioPanel.tsx`, `src/pages/lyrics/panels/LyricsPanel.tsx`, `src/pages/lyrics/panels/MarkersPanel.tsx`, `src/lib/lyrics/useAudioEngine.ts`, `src/lib/lyrics/useTrimmedAudioUrl.ts`, `src/lib/lyrics/api.ts`, `supabase/functions/kanvas-lyrics-template/index.ts`, `supabase/functions/kanvas-lyrics-transcribe/index.ts`.
- No database migration is currently indicated; this looks like contract/state repair rather than schema failure.
- I’ll validate using live edge-function calls plus targeted UI behavior checks before calling it fixed.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>