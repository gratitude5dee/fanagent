## Problem

The UI still blocks with **"Database queue schema is not ready. Generation is blocked until the live migration is applied."** even though the live `fanpage-campaign` `diagnostics` endpoint reports every required table/column as ready (verified by direct curl — all `schema.*` flags `true`, `errors: []`, `warnings: []`).

Two things keep tripping the block in the browser:

1. The diagnostics call sometimes never lands (the runtime "signal is aborted without reason" we saw points to a fetch being aborted by React StrictMode double-mount / HMR), so `diagnostics` stays `null` after the first attempt and is never retried. Combined with stale bundles, the previous gate (`isFanAgentSchemaReady(null) === false`) re-appears.
2. Even when diagnostics succeeds, any single schema check that races into a transient timeout flips `schema.audioClips` (or sibling) to `false`, which the UI still treats as a hard block — even though the server already classifies that case as a transient *warning*, not an error.

The schema is, in fact, ready. The banner is purely a stale client-side gate.

## Plan

### 1. Stop blocking the UI on `schemaReady`

`src/components/autopilot/UploadStep.tsx`
- Remove the red `Database queue schema is not ready…` banner entirely. The same information is already surfaced (and kept fresh) in the `AutopilotPanel` diagnostics row with a colored dot + summary.

`src/components/autopilot/CampaignStep.tsx`
- Drop `!props.schemaReady` from the **Generate library** button's `disabled` expression. Keep the other preconditions (`trimmedAudioReady`, `lyricTemplateReady`, `busy`).

`src/components/AutopilotPanel.tsx`
- `startCampaign`: remove the `if (diagnostics && !schemaReady) throw …` precondition.
- `registerAndTranscribeClip` effect: change the early return condition from `!accountId || !schemaReady` to just `!accountId`. The audio-clip registration call (`audio-clip-register`) will surface a real server error if a table is genuinely missing — we no longer need to pre-block it from the client.
- Keep the diagnostics dot + tooltip in the status row so the operator can still see live schema health, but it is informational only.

### 2. Harden `isFanAgentSchemaReady` against transient flips

`src/lib/fanagent/diagnostics.ts`
- Currently a single `false` boolean (e.g. a transient timeout on `audio_clips`) is treated as "not ready". Tighten it so it only returns `false` when the server also reports a hard `errors[]` entry. If every flag is `true` *or* the only problem is in `warnings[]`, treat the schema as ready.
- This matches the server's intent: `checkSchema` already separates transient retries (warnings) from real failures (errors).

### 3. Auto-recover from a missed diagnostics call

`src/components/AutopilotPanel.tsx`
- Add `refreshDiagnostics` to the 15 s polling interval that already drives `refresh()` (currently only `list` is re-polled). This way a single aborted/timed-out diagnostics call self-heals within 15 s instead of staying `null` until the user manually navigates away.
- Make `refreshDiagnostics` swallow `request aborted` errors silently (don't `setMessage`) so a StrictMode-aborted fetch doesn't surface a toast.

### 4. Verification

- `bunx vitest run tests/diagnostics.test.ts` — update assertions so `isFanAgentSchemaReady` returns `true` when only `warnings` are present and `false` only when `errors` are non-empty.
- Manual: hard refresh the home page, confirm the red banner is gone, confirm the **Launch** button is enabled, confirm the diagnostics row still shows `ready` with a green dot.

## Files touched

- `src/components/autopilot/UploadStep.tsx`
- `src/components/autopilot/CampaignStep.tsx`
- `src/components/AutopilotPanel.tsx`
- `src/lib/fanagent/diagnostics.ts`
- `tests/diagnostics.test.ts`

No edge-function, migration, or backend changes are required — the database schema is already correct.
