# Fix plan

## What I found

Two separate problems are showing up:

1. **Home page / Autopilot error**
   - The current browser network snapshot shows `fanpage-campaign` itself returning **200 OK** on home page load for `action: "list"`.
   - That means the visible message **“Failed to send a request to the Edge Function”** is likely coming from:
     - a deeper child call during campaign launch, or
     - the frontend’s generic `supabase.functions.invoke()` error handling, not the top-level list request.
   - The UI currently blocks launch on `schemaReady`, and that value is derived from the **diagnostics endpoint**, which is doing many time-bounded schema/storage checks. A transient diagnostics failure can therefore make the UI say **“Database queue schema is not ready”** even when the queue tables likely exist.

2. **Runtime loop**
   - The runtime stack clearly identifies a React loop:
     - `LyricsWizard.tsx:96` → `onMarkersChange`
     - `MarkersPanel.tsx:25-35` effect calling `onChange`
   - `MarkersPanel` fires `onChange(markers)` in an effect, which updates parent state, which re-renders the child, which can keep retriggering the effect. That is the direct cause of the **Maximum update depth exceeded** error.

## Proposed implementation

### 1) Fix the React update loop in the lyrics flow
- Update `src/pages/lyrics/panels/MarkersPanel.tsx` so it does **not** call `onChange` from a passive sync effect on every render cycle.
- Change marker propagation to happen only on **user-driven edits**:
  - add marker
  - delete marker
  - drag marker commit
  - undo/redo
- Keep the existing local state sync from `template.cut_markers`, but guard it so it only updates when the incoming markers are actually different.

### 2) Make the Autopilot preflight less fragile
- Update `src/components/AutopilotPanel.tsx` so launch gating is based on **hard failures only**, not transient diagnostics noise.
- Treat diagnostics as:
  - **informational** for warnings/timeouts
  - **blocking** only when the schema check conclusively reports missing required tables/columns
- Avoid using an initially-null diagnostics result as a hard block if the campaign create path itself is valid.

### 3) Improve edge-function error surfacing on the homepage
- Update the frontend function wrappers in:
  - `src/components/AutopilotPanel.tsx`
  - `src/App.tsx`
  - `src/lib/fanagent/audioClip.ts`
  - `src/lib/lyrics/api.ts`
- Normalize Supabase function errors so the UI shows the **real server/body error** when available instead of the generic **“Failed to send a request to the Edge Function”** message.
- Add a small helper to unwrap `FunctionsFetchError` / aborted fetch cases and preserve useful context for users.

### 4) Verify the create path used by campaign launch
- Review `supabase/functions/fanpage-campaign/index.ts` → `create` → `create-generation-batch` path.
- Confirm whether the current launch payload from `AutopilotPanel` matches `create-generation-batch` expectations (`audioClipId`, `duration`, `lyricTemplateId`, `stockSettings`, `publishDefaults`).
- If needed, tighten validation or error translation in `fanpage-campaign` so child-function failures come back as actionable envelopes instead of transport-looking failures.

### 5) Validate the actual schema blocker separately from diagnostics
- Audit whether `generation_batches.settings`, queue columns on `generation_items`, and related tables are truly present.
- If the schema is genuinely incomplete, I’ll identify the exact missing structure and prepare the required migration step separately.
- If the schema is already present, I’ll remove the false-negative gating coming from diagnostics timeouts/transient checks.

## Files likely to change
- `src/pages/lyrics/panels/MarkersPanel.tsx`
- `src/pages/lyrics/LyricsWizard.tsx`
- `src/components/AutopilotPanel.tsx`
- `src/App.tsx`
- `src/lib/fanagent/audioClip.ts`
- `src/lib/lyrics/api.ts`
- possibly `supabase/functions/fanpage-campaign/index.ts`

## Technical notes
- The runtime loop root cause is already identified from the stack trace; that one is ready to fix directly.
- The homepage error is probably **not** the `fanpage-campaign list` request on mount, because the captured request succeeded.
- The most likely failure point is the **launch flow** after trimming/registering/transcribing audio, combined with fragile diagnostics-based blocking and generic frontend error handling.

## Result
After implementation, the app should:
- stop throwing the maximum update depth error,
- stop falsely reporting schema-not-ready on transient diagnostics issues,
- show the real edge-function failure reason when launch actually fails,
- and make the Autopilot homepage much easier to debug going forward.