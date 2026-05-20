# /lyrics ↔ /remix unification (using existing seedance/stock render pipeline)

Adopt the brief's template lifecycle (author → edit → remix → render) and replace Autopilot's inline lyrics wizard with a template picker. **Skip Remotion + external worker**: reuse the existing `create-generation-batch` → seedance/stock pipeline so renders work today inside Lovable. A Remotion preview/worker can be added later behind the same Remix UI.

## High-level architecture

```text
/lyrics                   gallery (list + New)
/lyrics/new               wizard step 1 (audio upload, trim)
/lyrics/:id               wizard resume (lyrics / markers)
/lyrics/:id/remix         editor — style, scale, aspect, footage slots, "Generate N"
/lyrics/:id/jobs          render history for that template

Autopilot
  Lyrics step → "Pick template" (modal opens /lyrics gallery in-place)
              → selected template id flows into campaign launch
              → create-generation-batch reads template's audio_clip + markers + lyric_blocks
```

## Work breakdown

### 1. Routing scaffold
- Add `react-router-dom` `<BrowserRouter>` in `src/main.tsx`.
- Move current `App.tsx` body into `src/pages/Home.tsx` (route `/`), keep query-param behavior.
- New `src/lib/routes.ts` with `appRoutes` from the brief.
- New routes in `App.tsx`: `/`, `/lyrics`, `/lyrics/new`, `/lyrics/:templateId`, `/lyrics/:templateId/remix`, `/lyrics/:templateId/jobs`.

### 2. `/lyrics` gallery (`src/pages/lyrics/LyricsHome.tsx`)
- Calls existing `lyricsApi.list()`.
- Grid of template cards (title, status, duration, thumbnail placeholder). Card click:
  - `status === 'saved'` → `/lyrics/:id/remix`
  - else → `/lyrics/:id`
- "+ New template" → `/lyrics/new`.
- Archive/delete via existing `lyricsApi.archive`.

### 3. Wizard at `/lyrics/new` and `/lyrics/:id`
- New `src/pages/lyrics/LyricsWizard.tsx` that wraps the existing `LyricsTemplateBuilder` (already implements Audio/Lyrics/Markers).
- Pass `templateId` from route param; on finalize navigate to `/lyrics/:id/remix`.
- No behavioral change inside the panels.

### 4. `/lyrics/:id/remix` editor (`src/pages/lyrics/RemixEditor.tsx`)
- Loads template via `lyricsApi.get`.
- Left: preview pane (HTML5 `<audio>` + waveform + caption ticker driven by `lyric_blocks` + cut overlay from `cut_markers`). Pure DOM; no Remotion dependency.
- Right: controls — style preset, scale, aspect ratio (`9:16`/`1:1`/`16:9`), source mode (stock/seedance/library), prompt, quantity, cadence.
- Persist these into `render_defaults` (debounced 600 ms) via new `lyricsApi.patchRenderDefaults`.
- "Generate N videos" button → calls existing `create-generation-batch` edge function with:
  - `audioClipId` resolved from the template (see migration §6)
  - `lyricTemplateId: templateId`
  - prompt / quantity / cadence / sourceMode from render_defaults
- Add `render_defaults` schema: `{ lyricStyleId, scale, aspectRatio, sourceMode, prompt, quantity, cadenceMinutes, hashtags }`.

### 5. `/lyrics/:id/jobs`
- Lists `generation_batches` where `lyric_template_id = :id`, with batch-level progress (uses existing `video_library_items` aggregates).
- Reuses the rendering UI bits from `StudioReadyLibraryPanel` in compact form.

### 6. Template ↔ audio_clip linkage (DB)
- The existing pipeline keys off `audio_clips.id`, the template keys off `project_assets.id`. Add a bridge so finalize creates/links an `audio_clip` row from the template's trimmed asset.
- Migration (schema only — see Technical Notes for SQL): add `kanvas_lyric_templates.audio_clip_id uuid` plus a unique partial index, and add `audio_clips.lyric_template_id uuid` back-reference. Backfill is empty (no existing data assumed).
- Update `kanvas-lyrics-template` edge function `finalize` action to upsert an `audio_clips` row from the template's trimmed asset and store its id on the template.

### 7. Autopilot: replace inline wizard with template picker
- `src/components/autopilot/LyricsStep.tsx` becomes a picker: lists `lyricsApi.list()` results + "Create new" button that opens `/lyrics/new` in a new tab (or navigates with return query param).
- Selected `templateId` flows into `AutopilotPanel` campaign launch and is passed to `create-generation-batch` as `lyricTemplateId` (already a column on `generation_batches`).
- Remove inline `LyricsTemplateBuilder` from Autopilot; keep file for the wizard route to import.

### 8. Edge function changes
- `kanvas-lyrics-template/index.ts`:
  - New `patchRenderDefaults` action (validate shape, write-only to that column).
  - Modify `finalize` to upsert an `audio_clip` row and set `audio_clip_id`.
- `create-generation-batch/index.ts`:
  - When `lyricTemplateId` is provided and `audioClipId` is not, resolve `audioClipId` from the template.
  - Apply template's `cut_markers` and `lyric_blocks` into the per-item input_payload so `generate-video-prompts` / `stitch-segments` can use them as beat cuts (already partially supported via `lyric_template_id`).

### 9. Remotion (explicitly deferred)
- Keep the Remix preview as DOM/canvas. Render via the seedance/stock pipeline.
- Leave a `// TODO(remotion)` shim in `RemixEditor.tsx` that documents how to swap in `@remotion/player` and a future `kanvas-lyrics-render` edge function + external worker without changing the data model.

### 10. Tests
- Add unit tests for `lyricsApi.patchRenderDefaults`, route guards (saved → remix, draft → wizard), Autopilot picker.
- Add edge function test for `finalize` audio_clip upsert.
- E2E (Playwright): `tests-e2e/lyrics.spec.ts` — upload → transcribe (mocked) → finalize → remix → launch generation → batch row appears in `/lyrics/:id/jobs`.

## Files to add
- `src/lib/routes.ts`
- `src/pages/Home.tsx` (extracted from current `App.tsx`)
- `src/pages/lyrics/LyricsHome.tsx`
- `src/pages/lyrics/LyricsWizard.tsx`
- `src/pages/lyrics/RemixEditor.tsx`
- `src/pages/lyrics/RemixJobs.tsx`
- `src/components/lyrics/TemplateCard.tsx`
- `src/components/lyrics/RemixPreview.tsx` (DOM preview)
- `src/components/autopilot/LyricsTemplatePicker.tsx`

## Files to edit
- `src/main.tsx` (BrowserRouter)
- `src/App.tsx` (routes only)
- `src/components/AutopilotPanel.tsx` (use picker + send `lyricTemplateId`)
- `src/components/autopilot/LyricsStep.tsx` (becomes picker)
- `src/lib/lyrics/api.ts` (`patchRenderDefaults`, `list`, archive helpers)
- `src/lib/lyrics/types.ts` (`render_defaults` shape, `audio_clip_id` field)
- `supabase/functions/kanvas-lyrics-template/index.ts`
- `supabase/functions/create-generation-batch/index.ts`

## Migration (schema only)
- Add `kanvas_lyric_templates.audio_clip_id uuid` + index.
- Add `audio_clips.lyric_template_id uuid` + index.
- (Optionally) tighten `render_defaults` default to `'{}'::jsonb` — already is.
- No `remix_jobs` / `remix_renders` tables — we reuse `generation_batches` / `generation_items` / `video_library_items`.

## Out of scope (deferred)
- `@remotion/player` preview
- `kanvas-lyrics-render` edge function
- External Node Remotion worker, `remix_jobs` / `remix_renders` tables
- Sharing / public template gallery

## Technical notes

Migration SQL (illustrative):

```sql
alter table public.kanvas_lyric_templates
  add column if not exists audio_clip_id uuid;
create index if not exists kanvas_lyric_templates_audio_clip_id_idx
  on public.kanvas_lyric_templates(audio_clip_id);

alter table public.audio_clips
  add column if not exists lyric_template_id uuid;
create index if not exists audio_clips_lyric_template_id_idx
  on public.audio_clips(lyric_template_id);
```

Render-defaults persistence (debounced):

```ts
useEffect(() => {
  const t = setTimeout(() => {
    lyricsApi.patchRenderDefaults(templateId, draft).catch(...);
  }, 600);
  return () => clearTimeout(t);
}, [draft]);
```

Generation kickoff:

```ts
await invokeEdgeFunction("create-generation-batch", {
  accountId,
  lyricTemplateId: templateId,
  sourceMode: draft.sourceMode,
  prompt: draft.prompt,
  quantity: draft.quantity,
  cadenceMinutes: draft.cadenceMinutes,
  durationSeconds: template.selection_duration_ms / 1000,
});
```

Reply with **approve** to start implementation, or tell me what to change.