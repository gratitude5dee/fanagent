# Autopilot Stepper, Campaigns Page, and Regenerate Hardening

## Design Choices

- Treat `/Users/gratitud3/Downloads/fanagentfinal-main` as the standalone FanAgent repo and base this work on `origin/main`.
- Keep the current React 19 and React Router 7 dependency stack; do not downgrade packages.
- Preserve the existing Autopilot behavior by lifting state into a context first, then routing the same step components into focused pages.
- Keep `AutopilotPanel.tsx` as a default-on compatibility shim behind `VITE_AUTOPILOT_STEPPER=1` for this PR.
- Add Campaigns as the only campaign lifecycle surface; active, paused, and queue rows move out of the wizard.
- Use the existing Supabase Edge Function action vocabulary and add only `cancel { batchId }`.
- Use no database migrations; existing campaign, item, template, library, and render-attempt columns are sufficient.

## Implementation Order

1. Lift Autopilot state/effects into `AutopilotContext` and keep the legacy panel behavior intact.
2. Add `/autopilot/*` routes, step guard, stepper layout, focused step pages, and query-string redirect compatibility.
3. Add `/campaigns` and `/campaigns/:batchId`, including filtered batch list, row actions, and batch-scoped queue table.
4. Harden regenerate across UI, `fanpage-campaign`, and `render-karaoke`.
5. Update unit/e2e coverage and verify with typecheck, tests, lint, e2e, build, and Deno checks where available.
