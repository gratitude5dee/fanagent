## Root causes

### 1. `duplicate key … video_library_items_audio_clip_id_library_index_key` (the 500)

`video_library_items` has a unique constraint on `(audio_clip_id, library_index)`. When the user launches a new campaign reusing an existing `audio_clip_id` (e.g., same trimmed clip from a previous failed/canceled run), `create-generation-batch` inserts library rows with `library_index` starting at 0, which collide with the rows already attached to that clip.

The constraint should be scoped per batch, not per audio clip — `library_index` is a slot index within a batch.

### 2. `signal is aborted without reason` + `WaveSurfer is not initialized` in `AudioTrimmer.tsx`

React 18 StrictMode double-invokes effects in dev. The setup effect calls `ws.load(url)` (async fetch). The first cleanup runs `ws.destroy()` mid-fetch → unhandled `AbortError`. On the second mount, the same instance's `ready` handler can fire after destroy → `addRegion` throws "WaveSurfer is not initialized".

## Fix plan

### Migration (resolves the 500 blocking the home page)

1. Drop `video_library_items_audio_clip_id_library_index_key`.
2. Add `UNIQUE (batch_id, library_index)` (partial: `WHERE batch_id IS NOT NULL`) so the slot index is unique per batch.
3. Add supporting index `(audio_clip_id)` for the existing lookups that previously relied on the dropped composite.

### Code changes

- `src/components/autopilot/AudioTrimmer.tsx`
  - Add a `cancelled` flag captured by closure; on cleanup set it before `destroy()`.
  - In the `ready` handler, bail early if `cancelled` or `wsRef.current !== ws`.
  - Wrap `ws.destroy()` in `try/catch` to swallow `AbortError` from the in-flight `load()` fetch.
  - Guard `addRegion` with `if (!regionsRef.current) return`.

- `supabase/functions/create-generation-batch/index.ts`
  - Defensive: when reusing an existing `audioClipId`, compute the next `library_index` start as `max(library_index)+1` for that clip (belt-and-suspenders even after the constraint change), so re-launches stack rather than collide. Keeps backward compatibility with any rows created before the migration.

### Verification

- Re-run "Launch campaign" with the previously-failing audio clip → expect success.
- Open Autopilot Step 1 in dev/StrictMode → no `AbortError` / `WaveSurfer is not initialized` in console.
- Run `bunx vitest run` for affected tests.

### Files touched

- new migration (drop + recreate unique constraint, add index)
- `supabase/functions/create-generation-batch/index.ts`
- `src/components/autopilot/AudioTrimmer.tsx`
