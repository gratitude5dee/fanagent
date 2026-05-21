# Plan — Autopilot Wizard, Clips Page, Instant Render, Per-Video Fonts

This plan extends `goal/spec.md` and the existing Autopilot/Library code surgically. Nothing in the working surfaces (LyricsWizard, AudioTrimmer, FanAgentCalendar, StudioPostReview, envelope contracts, migrations) is rewritten — only the entry points and presentation layers change, plus two targeted edge-function additions.

## 1. Design tokens & shell

**`src/styles.css`** — add the dark-mode token block from the brief (`--bg-*`, `--accent*`, `--status-*`, `--font-*`, `--radius-*`). Re-skin existing classes in place (`.panel`, `.button`, `.batch-row`, `.dot`, `.banner`, `.topbar`, `.app-shell`) to consume tokens — keep class names so no component markup changes. Add new classes: `.wizard-step`, `.wizard-step.active`, `.wizard-step.complete`, `.step-summary`, `.step-number`, `.clip-grid`, `.clip-group`, `.clip-tile`, `.clip-actions`, `.sidebar`, `.sidebar-item`, `.sidebar-item.active`, `.mobile-tabbar`.

**`src/App.tsx`** — introduce a left sidebar (`<AppSidebar/>`, inline component or `src/components/AppSidebar.tsx`) with entries: Autopilot `/`, Clips `/clips`, Library `/library`, Calendar `/calendar`, Accounts `/settings/accounts`. The current mode-switch buttons in `.topbar` are removed; account selector + TikTok connect CTA stay on the right. Below 768px the sidebar renders as a bottom tab bar (icons only). All existing state wiring (`useStudioData`, query parsing, autopilot props) stays untouched.

**`src/main.tsx`** — add `<Route path="/clips" element={wrap(<ClipsPage/>)} />` with a lazy import.

## 2. Stepped Autopilot wizard

**`src/components/AutopilotPanel.tsx`** becomes a thin shim: it preserves the exported prop interface (`initialTab`, `focusLyricsStepSignal`, `initialLyricTemplateId`) and renders `<AutopilotWizard {...props} />`. All current state/handlers move into the wizard verbatim — `startCampaign`, `refresh`, polling, handoffs, lyric template selection, `lastLaunchedAudioClipId`, etc. The existing `GeneratedLibraryPreview` is retained but rendered inside Step 6 instead of below the form.

**`src/components/AutopilotWizard.tsx`** (new) owns:

- `step: "connect" | "upload" | "lyrics" | "category" | "campaign" | "generating"` plus a `completed: Set<Step>` so completed steps render as collapsed summary rows and the active step is the expanded card. Clicking a completed summary re-expands it without losing later state.
- Auto-advance rules exactly as in §2.3 of the brief.
- Reuses existing components: `ConnectStep`, `UploadStep`, `LyricsStep` (wraps `LyricsTemplateBuilder`), `CategoryPicker` (refined), `CampaignStep`, `GeneratedLibraryPreview`.
- Polling: `setInterval(refresh, activeBatches.length > 0 ? 5000 : 15000)`.
- When the first `video_library_items` row for `lastLaunchedAudioClipId` reaches `status==='ready'`, fire `toast("🎬 Your first video is ready!")` and `navigate('/clips?audioClipId=' + lastLaunchedAudioClipId)` — guarded by a `hasNavigatedRef` so it only fires once per campaign.

**`src/components/autopilot/CategoryPicker.tsx`** — replace the radio list with a responsive grid of large (min 120×80) cards: icon + name + `poolCounts.totalForCategory(cat.id)` badge. Sub-category row appears under the grid when a parent has children. Existing `onChange` contract preserved. Add a "Randomize clips" toggle bound to existing randomize state.

Other step components (`ConnectStep`, `UploadStep`, `LyricsStep`, `CampaignStep`) get only the summary-line additions (a small `<StepSummary/>` slot the wizard reads via render prop or by computing summary text in the wizard from current props — preferred: compute in wizard, no API changes to children). `UploadStep` gains real drag-and-drop handlers (`onDragOver`, `onDrop`) layered onto the existing file input.

## 3. Instant render path

**`supabase/functions/create-generation-batch/index.ts`** — when the incoming payload has a `lyricTemplateId`, default `autoRender = true` if the caller did not set it explicitly. No schema change (`generation_batches.auto_render` already exists).

**`supabase/functions/fanpage-generate-due/index.ts`** — after a successful stitch for an item whose batch has `auto_render = true`, invoke `render-karaoke` inline (same worker tick) guarded by a remaining-time-budget check (~20s soft cap). If the budget would be exceeded, leave the item in `stitched` state so the next cron tick picks it up (current behavior). No contract changes.

## 4. Per-video randomized font

**`supabase/functions/_shared/fonts.ts`** (new) — exports `LYRIC_FONTS` and a deterministic `pickFont(itemId)` using a 32-bit string hash mod `LYRIC_FONTS.length`.

**`supabase/functions/render-karaoke/index.ts`** — call `pickFont(generationItemId)`, thread the font name/weight into the existing subtitle compose call (ASS `Fontname` field / fal ffmpeg-api `fontFamily` param, whichever the current code uses). After successful render, `update generation_items set metadata = metadata || jsonb_build_object('lyric_font', font.name) where id = ...`. If the provider rejects unknown fonts at runtime, fall back to a fixed safe font and still record the *intended* font in metadata so the UI variation is preserved as a label even when the visual font is uniform.

**`src/components/library/LibraryTile.tsx`** — when `metadata.lyric_font` is present, show a small "Font: {name}" chip in the provenance line. No API change.

## 5. Category-locked sourcing

In `supabase/functions/_shared/sources/*` (the stock/pool adapters consumed by `pick-stock-clip`), when `categoryId` is set on the batch, filter `source_candidates` by `category_id = $categoryId` *before* the dedupe join. Already-supported `randomize=true` path skips this filter. This guarantees a Basketball campaign never falls back to generic stock. Add `categoryId` to `AdapterSearchInput` as already outlined in `goal/spec.md §5.1`.

## 6. Clips page

**`src/lib/clips/api.ts`** (new) — `fetchAllClips()` selects `video_library_items` joined to `audio_clips` and `generation_batches`, groups by `audio_clip_id`, returns `ClipGroup[] = { audioClip, batch, items[] }` sorted by most recent batch `created_at`.

**`src/pages/clips/ClipsPage.tsx`** (new) — top bar with Status / Category / Audio-clip filters and a sort dropdown; body renders one `.clip-group` card per audio clip. Tiles reuse `LibraryTile` (extended with hover autoplay via a small wrapper that swaps `<img>` for muted `<video autoPlay loop muted playsInline>` on `onMouseEnter`). Hover action bar: Schedule (opens existing `SingleScheduleDialog`/`BulkScheduleDialog`), Regenerate (calls existing `library-remix`), Download (anchor to `final_asset.public_url`). Multi-select + bulk schedule reuses `BulkScheduleDialog` exactly as `LibraryDetail` does. When `?audioClipId=` is present, that group is scrolled into view and pre-expanded.

## 7. Acceptance test alignment

A new `tests-e2e/wizard-flow.spec.ts` walks Connect → Upload → Lyrics → Category → Campaign → Generating → `/clips` against the dev fixture audio, asserting (a) wizard step transitions, (b) `/clips` group appears for the launched `audioClipId`, (c) tiles render with distinct `metadata.lyric_font` values across the batch, (d) a Basketball-category batch yields only basketball-tagged candidates in `source_candidate_uses`.

## Technical notes

- `AutopilotPanel`'s exported props and side-effects (lyric handoff, focus signal, initial template) stay byte-compatible — `tests/autopilot-lyrics-handoff.test.ts` must keep passing without changes.
- `GeneratedLibraryPreview` moves location but keeps its props (`audioClipId`).
- Polling change is local to the wizard; existing `useStudioData` cadence elsewhere is untouched.
- Sidebar uses `react-router-dom` `NavLink` for active styling; no shadcn sidebar dependency added unless we later want collapse animation (out of scope here).
- `pickFont` determinism keeps regenerate idempotent for the same `generation_item_id`.
- Inline render in `fanpage-generate-due` runs *after* the stitch DB write so a timeout never loses progress — worst case the cron tick re-enters at `stitched`.

## Files

**New:** `src/components/AutopilotWizard.tsx`, `src/components/AppSidebar.tsx`, `src/pages/clips/ClipsPage.tsx`, `src/lib/clips/api.ts`, `supabase/functions/_shared/fonts.ts`, `tests-e2e/wizard-flow.spec.ts`.

**Edited:** `src/styles.css`, `src/App.tsx`, `src/main.tsx`, `src/components/AutopilotPanel.tsx`, `src/components/autopilot/CategoryPicker.tsx`, `src/components/autopilot/UploadStep.tsx` (drag-drop only), `src/components/library/LibraryTile.tsx` (font chip + hover-autoplay wrapper), `supabase/functions/create-generation-batch/index.ts`, `supabase/functions/fanpage-generate-due/index.ts`, `supabase/functions/render-karaoke/index.ts`, `supabase/functions/_shared/sources/stock.ts` (+ peer adapters) for category filter, `supabase/functions/_shared/sources/types.ts` to add `categoryId` to `AdapterSearchInput`.

**Untouched:** all migrations, envelope/contract files, LyricsWizard/RemixEditor, AudioTrimmer, FanAgentCalendar, StudioPostReview, diagnostics, existing tests (unless an API they assert against changes — none planned).
