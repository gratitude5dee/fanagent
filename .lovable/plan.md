## Goal

Get the app to a clean running state (no runtime errors) and close the remaining open items from the "premium creator tool" overhaul that were deferred for risk.

## 1. Fix the "Invalid hook call" runtime error (root cause)

The stack trace shows **two different prebundled copies** of `react-dom/client` loaded in the same page:

- `react-dom_client.js?v=64fb7c3f`
- `react-dom_client.js?v=17f34875`

That happens when Vite re-optimizes deps mid-session (we recently added a sidebar route + lazy chunks) and HMR keeps the old module instance alive alongside the new one. Two React instances → `useRef` throws *Invalid hook call* the moment `App` re-mounts on `/`.

Fix:
- Restart the dev server to drop the stale prebundle cache (`code--restart_dev_server`).
- Remove `optimizeDeps.force: true` from `vite.config.ts` — forcing on every boot is what re-issues a new hash and orphans the previous one. With `dedupe` + explicit aliases, `force` is unnecessary and actively harmful here.
- Verify `/` loads with no console error and `/clips`, `/library`, `/lyrics` still mount through `AppShell`.

## 2. Wire the sidebar into the root route

Right now `App.tsx` (`/`) renders its own `topbar` and is NOT wrapped in `AppShell`, so the new sidebar only appears on sub-routes. Wrap `/` in `AppShell` too and drop the duplicate topbar's redundant nav links so the sidebar is the single navigation surface.

## 3. Finish the deferred items (smallest viable slice)

- **Inline render in `fanpage-generate-due`**: when an item finishes stitching inside the cron tick and we still have >15s of wall-clock budget, call `render-karaoke` synchronously before returning, so the first clip appears in `/clips` without waiting for the next tick.
- **Category-locked sourcing**: flip `lockCategory` default to `true` in `create-generation-batch` whenever a `categoryId` is set on the batch (adapter already supports it from the prior pass).
- **CategoryPicker polish**: add the clip-count badge we stubbed and a keyboard-accessible focus ring; no logic changes.

## 4. Verify

- Hard reload `/`, confirm no "Invalid hook call" in console.
- `/?wizard=1` still renders the wizard chrome.
- Run `bunx vitest run` for the touched edge-function unit tests (`tests/campaign.test.ts`, `tests/sources.test.ts`).
- Quick manual: upload audio → generate library → confirm first tile appears in `/clips` within one cron cycle.

## Out of scope

- Full `AutopilotPanel` monolith rewrite (still high-risk; wizard shim stays).
- Global design-token CSS reskin.
- E2E flake hardening beyond the existing `wizard-flow.spec.ts`.

## Files touched

- `vite.config.ts` (remove `force`)
- `src/App.tsx` (wrap in `AppShell`, trim duplicate nav)
- `src/components/autopilot/CategoryPicker.tsx` (count badge, focus ring)
- `supabase/functions/fanpage-generate-due/index.ts` (inline render budget)
- `supabase/functions/create-generation-batch/index.ts` (default `lockCategory`)
