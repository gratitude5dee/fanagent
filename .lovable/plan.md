# Lyrics Template → Autopilot Render Pipeline

Wire the standalone Lyrics Template Builder into the Autopilot pipeline so each generated post can render against word-level timing and cut markers from a saved template.

## Scope

- New "Lyrics" tab inside `AutopilotPanel.tsx`.
- Per-batch lyrics template selection at campaign launch.
- Per-item override on the queue list.
- `render-karaoke` consumes the chosen template's `lyric_blocks` + `cut_markers`.
- Marker-aware stock clip switching pass in stitch step (one clip per cut segment when markers exist).

Out of scope: editing templates from inside Autopilot (link out to `/lyrics/templates/:id`), Remotion composition rewrite, multi-track audio.

## Database (one migration)

- `generation_batches`: add `lyric_template_id uuid null` (no FK; soft ref).
- `generation_items`: add `lyric_template_id uuid null` (overrides batch).
- Index both columns.
- No RLS changes (tables are service-managed; existing read policies stay).

## Edge functions

1. `fanpage-campaign`
   - `list`: also return `lyric_templates` (id, title, status, total_duration_ms, selection_duration_ms) for the current `auth.uid()`.
   - `create`: accept optional `lyricTemplateId`; persist on the new batch + cascade to each generated `generation_items` row.
   - New action `setLyricTemplate { itemId | batchId, lyricTemplateId | null }`.

2. `create-generation-batch`: thread `lyricTemplateId` through to the inserted batch + items.

3. `render-karaoke`
   - Resolve template id: `item.lyric_template_id ?? batch.lyric_template_id`.
   - If set, fetch `kanvas_lyric_templates` row, build:
     ```
     inputProps = {
       ...existing,
       lyrics: { blocks: lyric_blocks, markers: cut_markers,
                 selectionStartMs, selectionDurationMs }
     }
     ```
   - Stub fallback: same passthrough as today, but record `lyric_template_id` on the input_payload for traceability.

4. `stitch-segments`
   - When `cut_markers.length > 0` and `segments.length === 1`, split the single stock clip into N sub-clips at marker timestamps before stitching against audio (uses existing ffmpeg helper).
   - When stitching multiple Seedance segments, snap segment boundaries to nearest marker (±200ms) for cleaner cuts.

## Frontend

`src/components/AutopilotPanel.tsx`
- Top-level tab bar: **Campaign** (current UI) / **Lyrics**.
- `Lyrics` tab body: list of templates from the new `list` payload with status pill, duration, "Edit in builder" link to `/lyrics/templates/:id`, and a "+ New template" button → `/lyrics/new`.
- Step 2 form: new field **Lyrics template (optional)** — `<select>` populated from same list, "None" default. Persists to `lyricTemplateId` in the `create` payload.
- Queue row (Step 3): show template title chip when set; popover `<select>` to override per item, calls `setLyricTemplate`.

`src/lib/lyrics/api.ts`: add `listTemplatesForAutopilot()` (thin wrapper over campaign list), keep current builder API untouched.

Styling: reuse existing `.panel`, `.status-pill`, `.batch-row` tokens. No new CSS variables.

## Types / generated files

After the migration the generated `src/integrations/supabase/types.ts` updates automatically. Frontend types:
- `Batch` and `Item` in `AutopilotPanel.tsx` gain `lyric_template_id: string | null`.
- New `LyricTemplateSummary` type in `src/lib/lyrics/types.ts`.

## Testing checklist

- Launch campaign without a template → unchanged behavior, render-karaoke uses stub passthrough.
- Launch with template → `generation_items.lyric_template_id` populated, render-karaoke logs include `lyric_template_id`, `input_payload.render.lyrics` present.
- Override on a single queue item → only that item's `lyric_template_id` changes.
- Template with 3 markers + 1 stock clip → stitched output has 3 cuts at the correct timestamps.
- Template deleted after use → render falls back to stub passthrough with a warning logged (no crash).

## File touch list

- migration: `supabase/migrations/<ts>_lyric_template_links.sql`
- edit: `supabase/functions/fanpage-campaign/index.ts`
- edit: `supabase/functions/create-generation-batch/index.ts`
- edit: `supabase/functions/render-karaoke/index.ts`
- edit: `supabase/functions/stitch-segments/index.ts`
- edit: `src/components/AutopilotPanel.tsx`
- edit: `src/lib/lyrics/api.ts`, `src/lib/lyrics/types.ts`
