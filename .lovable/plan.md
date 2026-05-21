## Goal

Make `/` actually look and behave like the spec: dark-mode design tokens, left sidebar shell, vertical stepped Autopilot wizard, and a real Clips page. No more `?wizard=1` opt-in, no more flat top-row buttons.

## 1. Design tokens (`src/styles.css`)

Add the full token set at the top of `:root` (keep existing variables that other components consume; new tokens shadow them where needed):

- Palette: `--bg-base #0a0a0f`, `--bg-surface #12121a`, `--bg-elevated #1c1c28`, `--bg-overlay #252535`
- Borders: `--border #2a2a3d`, `--border-subtle #1e1e2e`
- Accent: `--accent #7c3aed`, `--accent-glow #a855f7`, `--accent-muted rgba(124,58,237,.15)`
- Status: `--status-good #22c55e`, `--status-warn #f59e0b`, `--status-bad #ef4444`, `--status-idle #6b7280`
- Type: `--font-sans 'Inter', system-ui, sans-serif`, `--font-mono 'JetBrains Mono', monospace`
- Radius: `--radius-sm 6 / --radius-md 12 / --radius-lg 20 / --radius-xl 28`

Restyle `body`, `.app-shell`, `.topbar`, `.panel`, `.button`, `.button.primary`, `.batch-row`, `.dot.{good,warn,bad,idle}`, `.banner`, `.banner.warn`, `.banner.bad` to consume the new tokens. Existing classnames stay; only the values change.

Add new utility classes for the wizard + clips:

- `.wizard-shell`, `.wizard-step`, `.wizard-step.active`, `.wizard-step.complete`, `.step-number`, `.step-header`, `.step-summary`, `.step-body`
- `.clip-grid`, `.clip-group`, `.clip-group-header`, `.clip-tile`, `.clip-tile .clip-actions`, `.clip-tile:hover .clip-actions`

## 2. Shell + sidebar on the root route (`src/main.tsx`, `src/App.tsx`)

- Wrap `/` in `<AppShell>` (already imported by sub-routes) so every page shares the sidebar.
- `AppSidebar`: add the FanAgent wordmark header, group the items as Autopilot / Clips / Library / Calendar (separator) / Accounts, and use NavLink active state styled with `--accent-muted` background + `--accent` text.
- `App.tsx`: drop the mode-switch buttons from `.topbar`. Topbar keeps only the account selector + TikTok connect CTA on the right. On `/`, render `<AutopilotWizard />` as the primary view (no `?wizard=1` gate). Studio view stays reachable via `?mode=studio` and the Calendar sidebar link.
- Mobile (`< 768px`): the existing shadcn sidebar already collapses to an offcanvas drawer; keep that behavior. Add a CSS rule that pins `SidebarTrigger` to the topbar on narrow screens.

## 3. Real Autopilot wizard (`src/components/AutopilotWizard.tsx`)

Replace the shim. New component owns the stepped flow but DELEGATES all business logic to the existing handlers exported from `AutopilotPanel`. To avoid rewriting the 1231-line monolith we will:

1. Extract the state + actions from `AutopilotPanel.tsx` into a new hook `src/components/autopilot/useAutopilotController.ts` — pure mechanical move of the existing hooks, no behavior change.
2. `AutopilotPanel.tsx` becomes a 10-line wrapper: `return <AutopilotWizard {...props} />` (preserves the exported prop interface listed in §7).
3. `AutopilotWizard` consumes the controller hook and renders six stacked `<WizardStep>` cards:
   - **connect** → uses existing `ConnectStep` body; collapsed summary = handle + status dot.
   - **upload** → existing `UploadStep` body (already drag-drop + trimmer); summary = filename + duration chip.
   - **lyrics** → existing `LyricsStep`; summary = template title + word count + Saved badge; "Skip (no captions)" advances with warning.
   - **category** → existing refined `CategoryPicker` (grid already done last sprint); summary = icon + name.
   - **campaign** → existing `CampaignStep` body; Generate Library CTA disabled until prior steps complete.
   - **generating** → live progress panel reading `activeBatches` from the controller; polling reduced from 15s → 5s while `activeBatches.length > 0`. On first `status === 'ready'` item, fire a sonner toast "🎬 Your first video is ready!" and `navigate('/clips?audioClipId=' + lastLaunchedAudioClipId)`.

Step gating uses the rule table from §2.3 of the spec.

## 4. Clips page polish (`src/pages/clips/ClipsPage.tsx`, `src/lib/clips/api.ts`)

The route + grouping already exist from last sprint. This pass:

- Restyle with the new tokens (group cards, sticky group headers, status filter chips along the top).
- Add hover autoplay (muted) on `LibraryTile` via `onMouseEnter`/`Leave`.
- Add the per-tile font badge (already stored in `metadata.lyric_font`).
- Bulk select bar at the bottom: "Select all in group", "Schedule Selected" (opens existing `BulkScheduleDialog`).
- Filter dropdowns: status (all/unscheduled/scheduled/posted/failed), audio clip, category.

## 5. Verify

- `/` shows sidebar + 6 collapsed/active wizard cards. No old tab UI.
- Drag-drop audio → status pill animates → step auto-collapses.
- Generate Library → step 6 appears, polls every 5s, toast fires when first item lands.
- `/clips` renders groups with hover-play, font badge, working bulk schedule.
- `/library`, `/lyrics`, `/calendar` still work (they already use `AppShell`).
- No "Invalid hook call"; `bunx vitest run tests/autopilot.test.ts tests/autopilot-lyrics-handoff.test.ts` still pass after the controller extraction.

## Out of scope (per spec §10 + risk)

- Rewriting `render-karaoke` font integration — already shipped last sprint (`pickFont`, ASS subtitles, metadata.lyric_font).
- Category-locked sourcing — already shipped (`lockCategory` defaults true when categoryId set).
- Inline render in `fanpage-generate-due` — already present at line 353.
- Multi-tenant auth, new social platforms, AI music gen.

## Files touched

- **Edit**: `src/styles.css`, `src/main.tsx`, `src/App.tsx`, `src/components/AppSidebar.tsx`, `src/components/AppShell.tsx`, `src/components/AutopilotPanel.tsx`, `src/components/AutopilotWizard.tsx`, `src/pages/clips/ClipsPage.tsx`, `src/components/library/LibraryTile.tsx`.
- **Create**: `src/components/autopilot/useAutopilotController.ts`, `src/components/autopilot/WizardStep.tsx`.
