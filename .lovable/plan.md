# Sync Audio Playback with Lyric Highlighting

## Problem

In the Create Template wizard:

1. **Lyrics panel (step 2)** — Words are not visibly highlighted as the audio plays. The CSS `.lyr-word.active` exists and word timings are stored correctly (clip‑relative seconds, e.g. `start=0.079s end=0.28s` for the first word, last word ending at ~29.9s for a 30s clip), but the highlight does not move because the mini‑player isn't reliably driving `engine.currentTime` and there is no scroll‑into‑view on the active word.
2. **Cut Markers panel (step 3)** — The stage area shows only a single isolated word ("activeWord"). It should display the full current lyric line with the playing word accented, like the Remotion `LyricRemixComposition` does, kept in sync with audio.
3. Both panels share one `AudioEngine`. When the user presses play in either panel, the highlight should track across both.

DB sanity check confirmed `lyric_blocks[].words[].startTime/endTime` are seconds in the clip's local timeline, so they line up with `engine.currentTime` (which is already clip‑relative because `setLoop(0, clipSec)` is applied after `useTrimmedAudioUrl` resolves).

## Changes

### 1. `src/pages/lyrics/panels/LyricsPanel.tsx`
- Add `activeBlockId` derivation alongside `activeWordId`.
- Apply `lyr-block.active` class to the block containing the active word and `scrollIntoView({ block: 'nearest', behavior: 'smooth' })` via a ref keyed by `activeWordId` (rAF‑throttled to avoid scroll spam).
- Add a click handler on each non‑editing word: shift‑click seeks via `engine.seek(word.startTime)` so the user can scrub to a word. Plain click keeps the current "edit" behaviour.
- Make the mini‑player play button call `engine.toggle()` and reflect `engine.isPlaying`; also show a thin progress bar bound to `engine.currentTime / clipDuration`.

### 2. `src/pages/lyrics/panels/MarkersPanel.tsx`
- Replace the single‑word stage with a **karaoke line view**:
  - Derive the active block (line) using `engine.currentTime`.
  - Render the full line's words inline; the currently active word gets an accent style (`text-shadow`/color), upcoming words are dim, past words are slightly faded.
  - Add a subtle scale‑in animation on word change (CSS keyframe), echoing the Remix composition's `interpolate(... [0.86,1])` enter pose.
- Keep the existing `lyr-caption-ribbon` (prev / cur / next) but compute it from the active line's word list, not the global flatMap, so navigation stays within the current line.
- Make the existing scrub `.lyr-progress` clickable: clicking/dragging seeks the engine.
- Ensure restart button seeks to `0` AND starts playback when previously playing (preserve play state).

### 3. `src/components/autopilot/LyricsTemplateBuilder.tsx`
- After the trimmed URL loads, additionally call `engine.seek(0)` so the playhead resets when switching templates.
- Guard against double `engine.load(url)` for identical URLs (the hook already short‑circuits, but ensure `setLoop` only runs once when ready). No functional regression; just stabilizes the play head.

### 4. `src/styles.css`
- Add styles for:
  - `.lyr-block.active` (subtle border / glow on the current line).
  - `.lyr-karaoke-line` — flex row with `.word`, `.word.active` (accent), `.word.past` (faded), `.word.upcoming` (dim).
  - `@keyframes lyrWordPop` for the active word scale‑in.
  - `.lyr-progress.clickable` cursor + larger hit area.

## Technical Details

- `engine.currentTime` is already clip‑relative seconds (the loop starts at 0). Word timings are clip‑relative seconds. No unit conversion needed.
- The active‑word lookup stays O(words) per frame; the rAF in `useAudioEngine` already drives the re‑render via `setCurrentTime`. No additional polling.
- ScrollIntoView is rAF‑gated by tracking the last scrolled word id in a ref to avoid jitter.
- Karaoke line view receives `nowSec = engine.currentTime` and applies classes purely by comparison against `word.startTime/endTime`; no extra state.
- No DB schema or edge function changes. Reuses the existing `signTrimmedAudio` action and `useTrimmedAudioUrl` flow that was fixed in the prior turn.

## Acceptance

- Press Play in the Lyrics panel → words light up `.active` in time with the audio; the active block scrolls into view if off‑screen.
- Press Play in the Cut Markers panel → the stage shows the full current line with the active word visibly accented and a pop animation on change; the caption ribbon updates within the same line.
- Shift‑clicking a word in the Lyrics panel seeks the audio to that word.
- Clicking the progress bar in the Markers panel seeks the audio.
- Switching templates resets the playhead to 0 and the highlight clears.
