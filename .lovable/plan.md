## Prism Glass — Design Implementation Spec

A token-first refactor that ports the selected "Prism Glass v7" direction into the live app. No business-logic edits — all changes are in tokens, primitives, and presentational layers.

### 1. Design tokens (`src/styles.css`)

Replace the ad-hoc `:root` block (around lines 146–200) and tighten the dark theme tokens (100–133):

```text
Surfaces (dark, oklch / hex)
  --bg-base        #030303          (page)
  --bg-veil        rgba(255,255,255,0.02)  (header, alert strips)
  --bg-panel       rgba(255,255,255,0.03)  (cards, sidebar, side rails)
  --bg-elevated    rgba(255,255,255,0.05)  (active rows, inner controls)
  --bg-input       rgba(255,255,255,0.04)
  --hairline       rgba(255,255,255,0.06)  (default border)
  --hairline-strong rgba(255,255,255,0.10) (panel border + ring)
Accent system
  --accent         oklch(0.62 0.22 295)    purple
  --accent-soft    oklch(0.62 0.22 295 / 0.15)
  --accent-ring    oklch(0.62 0.22 295 / 0.30)
  --accent-glow    0 0 24px oklch(0.62 0.22 295 / 0.35)
  --grad-brand     linear-gradient(135deg, oklch(0.72 0.18 290), oklch(0.55 0.22 285), oklch(0.42 0.20 270))
Type scale (Inter, tracking-tight, weight 300/500/700/900)
  display 24/28 black -0.03em
  h1      18/22 bold  -0.02em
  body    13/18 medium
  micro   10/14 black uppercase 0.25em (section eyebrows)
Radii: sm 10, md 14, lg 20, xl 28, pill 999
Motion: ease-glass cubic-bezier(.34,1.56,.64,1); durations 200/350/500/700
```

Map these into the existing `@theme inline` block (so Tailwind `bg-panel`, `border-hairline`, `text-eyebrow` etc. are first-class), and update `.dark` `--sidebar*` / `--card` / `--popover` / `--border` / `--ring` / `--primary` to point at the new tokens.

Add two new global decorations behind `body > #root`:
- fixed `.bg-noise` overlay (SVG noise, opacity .03, z 50, pointer-events none)
- two `.bg-aurora` blurred radial blobs (purple top-left, indigo bottom-right, blur 160–200px, `pointer-events: none`, animated via `@keyframes auroraPulse`).

### 2. Shell + sidebar

`src/components/AppShell.tsx`
- Wrap with `<div className="app-root">` containing the noise + aurora layers, then sidebar + main.
- Replace the mobile header with a glass `header.app-topbar` (h-20, backdrop-blur-xl, hairline border, ring-inset). Mount it inside `AppShell` so every page inherits chrome; per-page title/subtitle/actions are passed via a tiny `<PageHeader>` primitive (new file `src/components/PageHeader.tsx`).

`src/components/AppSidebar.tsx` + `src/components/ui/sidebar.tsx` styling overrides in `styles.css`
- Width 288px → 80px collapsed; transition 700ms `ease-glass`.
- Brand: 36×36 gradient tile (`--grad-brand`), rotates 6° on sidebar hover, white-to-60% gradient text "FanAgent" weight 900, tracking -0.03em.
- Nav items: 13px semibold, opacity-70 icon, 12px y padding, rounded-xl, hover = `bg-elevated` + hairline-strong border.
- Active item: `bg-panel`, ring-1 inset white/10, icon tinted `--accent`, label `text-purple-300`.
- Section eyebrow "Resources" above Library/Clips/Lyrics (micro type).
- Bottom-divider Accounts row.

### 3. Reusable presentation primitives (new)

- `src/components/ui/glass-panel.tsx` — `<GlassPanel variant="rail | card | hero" />` renders the `bg-panel + hairline + ring-inset + backdrop-blur-2xl + rounded-[2rem]` shell used by every column/card.
- `src/components/ui/eyebrow.tsx` — micro uppercase label.
- `src/components/ui/stat-card.tsx` — bar-chart + big number + delta pill (used by Studio sidebar + Campaigns summary).
- Extend `buttonVariants` in `src/components/ui/button.tsx`:
  - `glass` — `bg-panel border-hairline-strong hover:bg-elevated`
  - `prism` — white bg/black text, rounded-full, uppercase italic, "Export Queue" style
  - `accent` — purple gradient + `--accent-glow` shadow, pill
  - `pillToggle` — segmented control look (Week/Month).

### 4. Page-by-page surface application

| Page | Treatment |
|---|---|
| Autopilot wizard (`AutopilotLayout.tsx`, `steps/*`) | Step pills become segmented `pillToggle` row inside topbar; each step card becomes `<GlassPanel variant="hero">`; Continue = `accent`, Back = `glass`; sticky footer uses `bg-veil + backdrop-blur-xl + hairline top`. |
| Studio / Calendar (`StudioCalendarPanel.tsx`, `StudioReadyLibraryPanel.tsx`, `StudioPostReview.tsx`) | 3-column grid wrapped in glass rails; Ready Library cards: `bg-elevated`, hover scale 1.02, accent border on hover, eyebrow + 12s tag chip; Post Review uses gradient amber alert block + accent CTA; toggles re-styled as compact pill switches. |
| Campaigns table (`CampaignsTable.tsx`, `CampaignSummaryCard.tsx`) | Filter bar inside glass rail; rows become `GlassPanel` cards with hairline divider, status badge as eyebrow pill (GENERATING in accent-soft), Open/Pause/Cancel as `glass` buttons. |
| Campaign detail (`CampaignDetailPage.tsx`) | Summary becomes 4-up stat-card grid; queue empty state gets dashed hairline + micro label "DROP TO IMPORT" equivalent. |
| Clips (`ClipsPage.tsx`) | Filter chips → `pillToggle`; per-audio group rendered as `GlassPanel`; thumb tiles 9:16 with hover scale + gradient bottom-shadow caption strip; actions in compact `glass` row. |
| Library (`LibraryLanding.tsx`, `LibraryGrid.tsx`) | Audio rows become hairline list inside glass rail; right-side chevron + eyebrow status; search input gets `bg-input + hairline-strong + focus accent-ring`. |
| Lyrics (`LyricsHome.tsx`) | "New template" = `accent` pill; template cards = `GlassPanel`, status badge as eyebrow chip (SAVED → green-soft, LYRICS_READY → amber-soft). |
| Calendar grid (Studio view, `FanAgentCalendar.tsx`) | Day cells: `bg-panel/40` rounded-3xl, hover lift, today cell `ring-2 ring-accent/20`; event chip = gradient accent card with time eyebrow + status dot; empty hover reveals "DRAG HERE" microcopy. |

### 5. Motion + micro-interactions

Define in `styles.css`:
- `.hover-lift { transition: transform 350ms var(--ease-glass); } .hover-lift:hover { transform: translateY(-1px) scale(1.01); }`
- `.press { transition: transform 200ms ease-out; } .press:active { transform: scale(.96); }`
- Sidebar brand rotate-on-hover and collapse chevron.
- `@keyframes auroraPulse` (16s ease-in-out infinite alternate).
- Apply `hover-lift` to all cards (Library tile, Clip tile, Campaign row, Calendar event), `press` to all primary buttons.

### 6. Accessibility / contrast

- All accent-on-glass states verified ≥4.5:1 (purple-300 on `bg-panel`).
- Focus visible: `outline-2 outline-offset-2 outline-[--accent-ring]` on every interactive element.
- `prefers-reduced-motion` disables aurora + hover-lift.

### 7. Files touched

```
src/styles.css                                       (tokens, classes, keyframes)
src/components/AppShell.tsx                          (root layers + topbar mount)
src/components/AppSidebar.tsx                        (markup + classes)
src/components/PageHeader.tsx                        (new)
src/components/ui/glass-panel.tsx                    (new)
src/components/ui/eyebrow.tsx                        (new)
src/components/ui/stat-card.tsx                      (new)
src/components/ui/button.tsx                         (variants)
src/components/AutopilotWizard.tsx                   (chrome)
src/pages/autopilot/AutopilotLayout.tsx              (header + footer)
src/pages/autopilot/steps/{Connect,Upload,Lyrics,Campaign,Review}Page.tsx (GlassPanel wrap)
src/components/studio/{StudioCalendarPanel,StudioReadyLibraryPanel,StudioPostReview}.tsx
src/components/FanAgentCalendar.tsx
src/pages/campaigns/{CampaignsPage,CampaignDetailPage}.tsx
src/pages/campaigns/components/{CampaignsTable,CampaignSummaryCard,CampaignFilters,CampaignRowActions,QueueTable}.tsx
src/pages/clips/ClipsPage.tsx
src/pages/library/{LibraryLanding,LibraryDetail}.tsx + src/components/library/{LibraryGrid,LibraryTile}.tsx
src/pages/lyrics/LyricsHome.tsx
```

### 8. Out of scope

- No data-model, API, edge-function, or routing changes.
- No new dependencies (Inter is already available via system stack fallback; we'll add a single `<link>` for Inter weights 300/500/700/900 in `index.html`).
- Existing tests continue to pass — they assert behavior + selectors that survive these visual changes.

### 9. Verification

- Visual: walk Autopilot → Campaigns → Clips → Library → Lyrics → Calendar and confirm glass shell, gradient brand, eyebrow labels, accent CTAs, hover-lift on cards, sticky wizard footer no longer covers Save Template (existing fix preserved).
- Build + `pnpm test` (Vitest) + targeted Playwright smoke for `/autopilot/connect`.
