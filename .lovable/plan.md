## What’s actually broken
The Studio page is creating batches, but the queued items stay `pending` instead of progressing.

From the code I traced, the most likely root cause is a **source-mode mismatch**:
- The root Studio UI sends `gmi_seedance` or `remote_render`
- `create-generation-batch` currently only recognizes `seedance`, `mixed`, or `stock`
- Anything else is silently coerced to `stock`
- That means the chosen provider is lost before generation begins, so the wrong pipeline path runs

I also need to verify the secondary handoff from the **Generate due** button into `fanpage-campaign` and then into the generation workers, because the current failure is effectively silent.

## Plan
1. **Normalize source-mode contracts end-to-end**
   - Make the frontend and edge functions agree on the same source-mode values
   - Ensure `create-generation-batch` preserves `gmi_seedance` and `remote_render` instead of downgrading them to `stock`
   - Confirm each mode writes the correct `source_mode`, `provider`, and model settings into `generation_batches` and `generation_items`

2. **Audit the worker routing from the manual buttons**
   - Verify `fanpage-campaign` receives the `runGenerationWorkers` action from the root Studio UI
   - Confirm the action triggers the correct worker for each provider path
   - Tighten error propagation so a worker failure returns a useful message instead of leaving items silently pending

3. **Harden visibility for stuck items**
   - Add explicit logging/status updates around the generation worker chain so the next failure is attributable
   - Surface the actual backend error in the UI message area when a child function fails
   - Make sure failed items move to `failed` with a readable error instead of appearing idle

4. **Validate the full flow for the affected modes**
   - Re-test queueing and running generation for the root Studio flow
   - Confirm `remote_render` items no longer get stored as `stock`
   - Confirm the first due item advances out of `pending` when Generate due is clicked

## Technical details
- Files already implicated:
  - `src/App.tsx`
  - `src/lib/fanagent/types.ts`
  - `supabase/functions/create-generation-batch/index.ts`
  - `supabase/functions/fanpage-campaign/index.ts`
  - `supabase/functions/fanpage-generate-due/index.ts`
  - `supabase/functions/process-generation-due/index.ts`
  - `supabase/functions/_shared/generation.ts`
- Specific defect found during investigation:
  - `src/App.tsx` uses `SourceMode = "gmi_seedance" | "remote_render"`
  - `create-generation-batch` currently normalizes only `seedance` / `mixed` / `stock`, so `gmi_seedance` and `remote_render` are being misclassified
- Current database evidence:
  - recent `generation_batches` are being created successfully
  - recent `generation_items` remain `pending`
  - recent items are being stored with `provider = stock`, which is inconsistent with the UI mode shown in the screenshot

If you approve, I’ll implement the contract fix first, then verify the worker handoff and error reporting.