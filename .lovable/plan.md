## Plan

1. Update the `kanvas-lyrics-template` finalize bridge so it only writes valid `audio_clips.transcription_status` values.
   - Replace the invalid `"completed"` value with the status that matches the existing pipeline contract.
   - Use the project’s existing semantics: `ready` when the bridged clip already has usable lyrics/transcript data for downstream generation, otherwise `pending`.
   - Keep the current `account_id`, `media_assets`, and `audio_clips` bridging logic intact.

2. Make the status decision explicit and resilient.
   - Derive the inserted clip state from template data instead of a loose `Array.isArray(...)` check alone.
   - Treat a template with actual lyric blocks as generation-ready; otherwise leave it pending so the normal transcription/manual flow can still run.
   - Preserve metadata indicating the row was created by `kanvas-lyrics-template:finalize`.

3. Validate the edge-function behavior against the current database contract.
   - Confirm the function now aligns with the DB constraint: allowed values are `pending`, `running`, `ready`, `failed`, and `manual`.
   - Re-check recent logs after the change to ensure the 500 disappears.
   - Verify the saved template can finalize successfully and returns an `audio_clip_id` for the downstream campaign/video-generation pipeline.

## Technical details

- **Root cause:** `supabase/functions/kanvas-lyrics-template/index.ts` inserts `transcription_status: "completed"`, but `public.audio_clips` only permits:
  - `pending`
  - `running`
  - `ready`
  - `failed`
  - `manual`

- **Why this fix is correct:**
  - The rest of the codebase already treats `ready` as the terminal success state for transcription.
  - `audio-clip-transcribe` upgrades clips from `running` to `ready`.
  - `audio-clip-register` and `create-generation-batch` create clips as `pending`.
  - No other valid flow uses `completed` for `audio_clips.transcription_status`.

- **Files to change:**
  - `supabase/functions/kanvas-lyrics-template/index.ts`

- **No migration needed:**
  - This is a code/data-contract mismatch, not a schema problem.