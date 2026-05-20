## Goal
Make the lyrics wizard fully recover when a template/audio-clip pair points at an invalid trimmed asset, so playback and the Retry audio button actually work.

## What I’ll change
1. **Broaden template repair in the wizard load path**
   - Stop only repairing when `trimmed_audio_asset_id` is null.
   - Treat these as repair-needed states too:
     - trimmed asset exists but signed-URL hydration fails
     - template has `transcript_meta.audio_clip_id` / `render_defaults.audio_clip_id`
     - template references a stale or mismatched asset record
   - On repair, rebuild from `audioClipId` and replace local state with the repaired template.

2. **Harden the Retry audio action**
   - Change Retry from “re-sign the same asset” to “reconstruct the template/audio linkage from the source audio clip when possible”.
   - If repair succeeds, immediately reload the shared audio engine with the recovered signed URL.
   - If no `audioClipId` exists, keep the current error but make it explicit that the template must be recreated/uploaded.

3. **Make the edge function self-heal bad template rows**
   - Update `kanvas-lyrics-template` so `createFromAudioClip` repairs existing default templates not only when `trimmed_audio_asset_id` is missing, but also when the referenced `project_assets` row is incomplete or inconsistent.
   - Re-point the template to a valid `project_assets` row derived from the source `media_assets` / `audio_clips` record.

4. **Protect playback hydration**
   - Update the trimmed-audio URL hook to distinguish:
     - missing asset row
     - missing `storage_path`
     - signing failure
   - When possible, bubble a structured “repairable” failure so the wizard can auto-rebuild instead of just toasting an error.

5. **Validate the full flow**
   - Test the failing template-picker path (`createFromAudioClip`) and confirm:
     - no more “Trimmed audio asset is missing a storage path” banner
     - play button becomes ready
     - audio preview actually plays
     - Retry audio repairs stale templates instead of looping the same failure

## Technical details
- Files likely involved:
  - `src/components/autopilot/LyricsTemplateBuilder.tsx`
  - `src/lib/lyrics/useTrimmedAudioUrl.ts`
  - `src/lib/lyrics/api.ts` (if a dedicated repair action helps)
  - `supabase/functions/kanvas-lyrics-template/index.ts`
- No schema change is planned unless I discover a data-shape mismatch that cannot be repaired in code.
- Validation will use existing browser/network signals plus direct edge-function/database inspection of the repaired template path.