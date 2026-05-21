# Inline generated-library preview in Autopilot → Campaign

After the user clicks **Generate library**, render the just-created clips directly underneath the Campaign parameters form so they can review (and schedule) without navigating away to `/library/:id`.

## UX

```text
[ 4. Campaign parameters                ]
   ...form fields...
   [ Generate library ]
   ─────────────────────────────────────
   [ 5. Generated library preview     ]   ← NEW, appears after launch
       POP OUT (feat. ZayBang).wav · 6 clips · 15s each
       [All | Unscheduled | Scheduled | Posted | Blocked | Failed]
       [Select visible] [Clear] [Schedule selected] [Regenerate selected]
       <LibraryGrid> tiles (same component used by /library/:id)
       "Open full library →" link to /library/<audioClipId>
[ Active campaigns ]
[ Upcoming posts ]
```

Tiles match the screenshot layout (vertical aspect, status pill, caption). While items are still rendering they show the existing `NOT READY` / loader states from `LibraryTile`. The panel auto-refreshes every ~5s until every item is in a terminal state (`ready`, `failed`, `blocked`, `scheduled`, `posted`).

## What to build

1. **`AutopilotPanel.tsx`**
   - Add `lastLaunchedAudioClipId: string | null` state. Set it inside `startCampaign` after `callCampaign("create", …)` resolves, using `campaignHandoff.audioClipId` (the value already passed to the edge function).
   - Clear it when the user switches templates or changes the trimmed audio (so an old preview doesn't linger over a new campaign).
   - Below `<CampaignStep />` (still inside the same `<form>`'s parent, but outside the form so its buttons aren't submit triggers), render a new `<GeneratedLibraryPreview audioClipId={lastLaunchedAudioClipId} />` when set.

2. **New `src/components/autopilot/GeneratedLibraryPreview.tsx`**
   - Uses existing `getLibraryDetail(audioClipId)` from `@/lib/library/api` to load `{ clip, items }`.
   - Polls every 5s while any item is in a non-terminal status; stops polling once all are terminal.
   - Reuses `LibraryGrid` for the tiles and the existing bulk-select hooks.
   - Bulk bar: **Schedule selected** (opens existing `BulkScheduleDialog`), **Regenerate selected** (calls `callCampaign("regenerate", { itemId })` per selection — same handler pattern already in `AutopilotPanel`).
   - Header shows clip title, item count, source-clip duration; status filter chips mirror the screenshot (`All / Unscheduled / Scheduled / Posted / Blocked / Failed`).
   - Includes a small `Link to={`/library/${audioClipId}`}` for the full page experience.

3. **No edge-function or schema changes.** `fanpage-campaign` already creates `video_library_items` rows synchronously inside `create-generation-batch`, so `getLibraryDetail` returns the tiles immediately (initially with `not_ready` / `failed` status, then transitioning as `process-generation-due` and `render-callback` progress them).

## Out of scope

- No changes to marker→clip pairing, lyric overlay rendering, or generation pipeline.
- No edits to `LibraryGrid` / `LibraryTile` themselves — reused as-is.
- No moving of the existing **Upcoming posts** panel; the new preview sits above it.

## Files

- **Edit**: `src/components/AutopilotPanel.tsx`
- **Create**: `src/components/autopilot/GeneratedLibraryPreview.tsx`
