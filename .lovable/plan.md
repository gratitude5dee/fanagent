## Goals

1. While the user adds/edits/deletes words in the Lyrics panel, the Markers panel should immediately reflect the new words (karaoke line, captions, active word, block windows).
2. On a lyric add/delete, intelligently keep cut markers aligned:
   - Word deleted ⇒ drop the marker nearest that word's window (within tolerance).
   - Word added ⇒ insert a marker at the new word's start (snapped, deduped).
   - Markers the user manually placed elsewhere are preserved.
3. Clicking **Remix** / **Open remix** for a saved template should land the user in Autopilot → Campaign with that template already selected and "Generate library" enabled (no re-upload required).

---

## Part A — Live lyrics ↔ markers sync

**`src/components/autopilot/LyricsTemplateBuilder.tsx`**
- Add a debounced `onBlocksLive` handler (≈200ms) that:
  - `dispatch({ type: "patch", patch: { lyric_blocks: blocks } })` so MarkersPanel rerenders immediately.
  - Performs marker re-sync (see below) and dispatches the new `cut_markers` too.
  - Persists `{ lyric_blocks, cut_markers }` via `lyricsApi.patch` (fire-and-forget, last-write-wins).
- Keep existing `onLyricsDone` for the "Done" button which additionally flips status to `lyrics_ready` and advances to step 3.

**`src/components/autopilot/LyricsPanel.tsx`**
- Add `onBlocksLive?: (blocks: LyricBlock[]) => void` prop.
- After every `setBlocks(next)` in `commitWordEdit` / `deleteWord` / `addWord` / `deleteBlock` / `manualEntry`, fire `onBlocksLive(next)`.
- Continue to call `onDone` only from the explicit "Done" button.

**`src/lib/lyrics/markers.ts`** — add pure helpers:
- `resyncOnWordsChange(prevWords: {id, startTime, endTime}[], nextWords: ..., markers: number[]): number[]`
  - Compute removed = prev.filter(p => !next.find(n => n.id === p.id))
  - Compute added   = next.filter(n => !prev.find(p => p.id === n.id))
  - For each removed word: `deleteAt(markers, midpoint(word))` (only if the nearest marker falls within the word's `[startTime - 0.05, endTime + 0.05]` window).
  - For each added word: `addMarker(markers, word.startTime)` (uses existing snap + dedupe).
  - Order: removals first, then additions.
- This is the only marker logic change; existing manual placement still works.

**Marker re-sync glue (in LyricsTemplateBuilder)**
- Compare `state.template.lyric_blocks` vs incoming `blocks` to derive prev/next flat word arrays, run `resyncOnWordsChange`, and dispatch the combined `{ lyric_blocks, cut_markers }` patch.

**`src/pages/lyrics/panels/MarkersPanel.tsx`**
- Already reads from `template.lyric_blocks` / `template.cut_markers`; no change needed beyond confirming the existing `useEffect([template?.cut_markers])` re-syncs local state (it does).

---

## Part B — Unblock "Generate library" from the Remix entry point

**Routing**
- Update `src/lib/routes.ts`:
  - `lyricsRemix(id) => `/?mode=autopilot&view=campaign&lyricTemplateId=${id}` (query string) so all remix links land in the Autopilot Campaign.
- `src/pages/lyrics/LyricsHome.tsx` "Open remix" / `LyricsWizard` post-save / `LyricsStep` Remix button already use `appRoutes.lyricsRemix(id)`, so the change propagates automatically.
- `src/App.tsx` initial-query handler:
  - Extend `readInitialAppQuery` (or inline) to read `lyricTemplateId` from URL and pass it down to `AutopilotPanel` as a new `initialLyricTemplateId` prop.
- Keep `RemixEditor` file but it becomes unreachable through new links (route still works for direct deep-links until removed in a later sprint).

**`src/components/AutopilotPanel.tsx`**
- New prop `initialLyricTemplateId?: string`.
- On mount, after templates load, if `initialLyricTemplateId` is present:
  - `setLyricTemplateId(initialLyricTemplateId)`
  - `setTab("campaign")`
  - Scroll the campaign step into view.

**Unblock the "Generate library" button when only a saved template is selected**
- The dependency chain currently requires `trimmedAudio` (a freshly uploaded blob). When the user arrives via Remix, `trimmedAudio` is `null` but the saved template already carries `audio_clip_id` + `trimmed_audio_asset_id`.
- `trimmedAudioReady` already accepts `(campaignHandoff.audioClipId && campaignHandoff.trimmedAudioAssetId)`, but `campaignHandoff.ready` requires `durationMatches` against `registeredAudioClip?.duration_sec ?? trimmedAudio?.durationSec ?? templateDurationSec`. With both right-side fallbacks null and `templateDurationSec` on both sides, `durationMatches` becomes `true` — confirm this path and add a unit-level guard so that selecting a saved template with no fresh upload yields `ready === true`.
- `startCampaign` already supports the no-`trimmedAudio` path (it falls through to `selectedTemplate.audio_clip_id`). No change needed there beyond removing/relaxing the `if (!trimmedAudio && !selectedTemplate.audio_clip_id)` branch — already correct.
- Fix the actual blocker: **`!selectedTemplate.cut_marker_count`** path. Currently `poolBlocked` uses `requiredShots = selectedTemplate?.cut_marker_count ?? 1`. When a Remix-launched template has cut markers > pool size and `randomize=false`, it stays blocked. Default `randomize` to `true` when the user arrives with `initialLyricTemplateId` so the first launch is never pool-blocked; the user can opt out manually. (This matches the "instant remix" intent.)

---

## Technical notes

- All marker math stays in `src/lib/lyrics/markers.ts`; UI components remain dumb.
- Debounce live patch in builder to avoid hammering `kanvas-lyrics-template` on every keystroke.
- No DB schema changes. No edge-function changes.
- Tests: extend `tests/` with a small unit test for `resyncOnWordsChange` (added/removed/preserved cases) — sibling of existing marker helpers.

---

## Files touched

```text
src/lib/lyrics/markers.ts                          (add resyncOnWordsChange)
src/pages/lyrics/panels/LyricsPanel.tsx            (add onBlocksLive)
src/components/autopilot/LyricsTemplateBuilder.tsx (wire onBlocksLive + marker resync + debounced persist)
src/lib/routes.ts                                  (lyricsRemix → autopilot deep link)
src/App.tsx                                        (parse lyricTemplateId from URL, forward to AutopilotPanel)
src/components/AutopilotPanel.tsx                  (initialLyricTemplateId prop, default randomize=true when present)
tests/lyrics-template.test.ts (or new file)        (unit test for resyncOnWordsChange)
```

No migrations, no edge functions, no Supabase config.
