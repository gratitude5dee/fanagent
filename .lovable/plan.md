# Stop the lyrics SAVE TEMPLATE bar from hiding behind the wizard footer

## Cause

`LyricsTemplateBuilder` renders a floating action bar with `position: fixed; bottom: 16px` (`.lyr-footer` in `src/styles.css` line 1845), which holds the SAVE TEMPLATE button. The Autopilot wizard wraps the page in `AutopilotLayout`, whose `.autopilot-step-footer` is `position: sticky; bottom: 0` with `z-index: 10` (styles.css line 2518). When the lyrics step is rendered inside the wizard, the wizard's sticky Back/Continue bar paints on top of the floating SAVE TEMPLATE bar, so the user can't click it.

## Fix (CSS only, in `src/styles.css`)

1. `.lyr-footer` — raise `bottom` from `16px` to `84px` so it floats above the ~64px-tall sticky wizard footer, and bump `z-index` from `10` to `20` so it always paints above it.
2. `.lyr-help` — raise `bottom` from `24px` to `92px` and bump `z-index` to `20` so the floating help button doesn't end up under the wizard footer either.
3. Add a tiny `padding-bottom: 96px` to `.autopilot-step-surface` so any non-floating content inside a step (when this lyrics builder is used standalone or other steps add buttons) keeps clearance from the sticky footer.

No component / TSX changes needed; this is a pure layering fix.

## Verification

- `/autopilot/lyrics` — SAVE TEMPLATE pill visible above the wizard's Back/Continue bar and clickable; help bubble no longer obscured.
- Standalone `/lyrics` route still renders the floating bar correctly (just 68px higher than before, still inside the viewport).
- No regression to other autopilot steps (Connect, Upload, Campaign, Review) — they don't use `.lyr-footer`.

## Files

- edit `src/styles.css` (three small rule edits)
