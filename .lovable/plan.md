## Goal

Fix three blockers in the Lyrics Template wizard:

1. Saving a template crashes with `account_id` NOT NULL on `audio_clips` (and `media_assets`).
2. The Lyrics step doesn't let you delete words (only inline-edit).
3. The Cut Markers preview stage is a generic rectangle — it needs to be a true 9:16 frame so what you see matches what the campaign renderer will produce.

---

## 1. Fix `account_id` violation in `kanvas-lyrics-template` finalize

**Root cause:** `supabase/functions/kanvas-lyrics-template/index.ts` lines 363 and 395 insert into `media_assets` and `audio_clips` with `account_id: null`. `audio_clips.account_id` is `NOT NULL` (and is required for the downstream campaign pipeline that joins clips → batches → posts).

**Fix:** Resolve an account id once per finalize call before the bridging inserts:

- Use the admin client to find a usable `accounts` row:
  1. If `tpl.data` carries an artist via `render_defaults` or metadata, use accounts for that artist.
  2. Otherwise pick the primary account: `accounts where is_primary = true` ordered by `created_at asc`, limit 1.
  3. If still none, fall back to the most recent account row.
- If still none exists, return a `KANVAS_LYRICS_TEMPLATE_NO_ACCOUNT` 400 with a clear message instead of letting Postgres reject the row.
- Pass the resolved `accountId` into both the `media_assets` insert (line 360) and the `audio_clips` insert (line 392).

Also write the same `account_id` onto the `kanvas_lyric_templates.render_defaults.account_id` so the campaign step can pick it up without re-resolving.

No schema migration needed (column already exists and accepts any uuid).

## 2. Lyrics step: edit + delete words/blocks

In `src/pages/lyrics/panels/LyricsPanel.tsx`:

- Inline word editor:
  - Empty submit (Enter on empty input, or blur with empty text) deletes the word from the block.
  - Add a small `×` button on each word (visible on hover) that removes only that word.
- Block-level controls in the block header:
  - `Add word` (appends a word at end with `startTime = lastWord.endTime`, `endTime = +0.4s`, clamped to clip duration).
  - `Delete block` (removes the entire block; if last block remains empty, the panel re-shows the "Type lyrics manually instead" CTA).
- Keep the seek-on-shift-click behavior.
- Block auto-cleanup: when a block ends up with zero words, drop it from `blocks` before persisting in `done()`.
- No changes to API/types — `LyricBlock` already supports arbitrary `words[]`.

## 3. Cut Markers: 9:16 preview stage

In `src/pages/lyrics/panels/MarkersPanel.tsx` + `src/styles.css`:

- Wrap the existing `.lyr-stage` content in a 9:16 frame:
  - New class `.lyr-stage-frame` with `aspect-ratio: 9 / 16`, centered, `max-height: 60vh` (so it fits within the wizard), and a subtle outline/inner shadow to communicate "this is the export canvas".
  - Reposition the CUT flash absolutely inside the frame (top-right) and keep the active karaoke line centered, using clamp-based font sizing tuned to 9:16.
- Caption ribbon (prev / cur / next) stays below the frame as a strip — unchanged contract, just restyled to sit under the 9:16 canvas.
- Marker track, controls, and waveform remain full-width below the stage.

No changes to data shape, audio engine, or marker math.

---

## Acceptance

- Create a template from a fresh upload → "SAVE TEMPLATE" succeeds (no 500). New row in `audio_clips` has a non-null `account_id`.
- In the Lyrics step you can: click a word to edit, submit empty to delete, click `×` to delete, `Add word` to append, `Delete block` to remove a whole block.
- In the Cut Markers step the karaoke preview is rendered inside a vertical 9:16 frame; the CUT flash, active word, and surrounding context all sit inside the frame; the marker track / controls remain below.
- Existing templates open without re-uploading audio (regression check from previous fix).

---

## Technical notes (for the engineer)

- Files changed:
  - `supabase/functions/kanvas-lyrics-template/index.ts` (account_id resolution helper + use it in the two inserts; persist on `render_defaults`).
  - `src/pages/lyrics/panels/LyricsPanel.tsx` (word delete + block add/delete UI; empty-cleanup on done).
  - `src/pages/lyrics/panels/MarkersPanel.tsx` (wrap stage in `.lyr-stage-frame`).
  - `src/styles.css` (new `.lyr-stage-frame` + adjustments to `.lyr-stage`, `.lyr-karaoke-line`, `.lyr-cut-flash`).
- No DB migration. No edge functions other than `kanvas-lyrics-template` are touched.
- No changes to `useAudioEngine`, `useTrimmedAudioUrl`, or `RemixEditor`.