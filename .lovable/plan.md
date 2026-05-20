## Categorized Clip Library + Instant Remix Engine

This is a large, multi-day build. Before I start coding I need to align on scope because **most of the spec already exists in this repo under different names** — building it twice would create two parallel pipelines and break everything. Here is the architectural read and the proposed plan.

---

### What already exists (and what the spec maps to)

| Spec concept | Already in repo as |
|---|---|
| `clips` table | `source_candidates` (has `source_type`, `provider`, `duration_seconds`, `is_portrait`, `license`, `perceptual_hash`) |
| `clip_categories` | `source_type` enum used by `_shared/sources/registry.ts` — currently: `stock`, `streamer_clip`, `sports_edit`, `seedance` (AI), plus `library` (reuse) |
| `lyric_templates` | `kanvas_lyric_templates` (has `lyric_blocks`, `cut_markers`, audio refs) |
| `campaigns` | `generation_batches` (has `source_mode`, `lyric_template_id`, `clip_filters` via `settings`, `quantity`) |
| `library_edits` | `video_library_items` (has `status: not_ready/ready/scheduled/posted`, `segments`, `final_asset_id`) |
| `render_jobs` | `generation_items` + `render_attempts` |
| Remix worker | `fanpage-generate-due` → `pick-stock-clip` → `stitch-segments` → `render-karaoke` |
| Studio "Ready" lane | `StudioReadyLibraryPanel` already exists |
| Calendar drag-to-schedule | `FanAgentCalendar` + `library-schedule` edge function |
| Category isolation | `_shared/sources/registry.ts` already gates by `source_type` |

The pipeline is real — your last few sessions were debugging it (the lyric template → audio_clip bridge, the cancelled 81 batches, etc.).

### What's actually missing vs. spec

1. **A first-class `clip_categories` table with subcategories** (basketball/football/etc.). Today `source_type` is flat — sports_edit has no sport-level partitioning.
2. **A category dropdown in Campaign Parameters** that replaces/augments the current `source_mode` selector and shows live pool counts per category/subcategory.
3. **Instant "Generate Library" + "Remix" buttons** that bypass scheduling and create `video_library_items` with `status='ready'` and **no `posts` row** (today every batch slot creates a scheduled post — see `create-generation-batch`). This is the core behavior change.
4. **Subcategory tagging on `source_candidates`** (a `subcategory` text column + tag-based filtering) so basketball ≠ football.
5. **Stratified "Randomize" sampling** across source_types in `pick-stock-clip`.
6. **Hard pool-size precheck** in the UI before enabling Generate (today it discovers shortage mid-render and fails the item).
7. **Studio "Ready" lane refinement** — already exists but currently mixed with scheduled posts; needs a clean filter for `ready & post_id IS NULL`.

### Proposed plan (phased — I'll pause for approval between phases)

**Phase 1 — Schema + category model** (1 migration)
- Add `clip_categories` table (slug, name, parent_id, icon, sort_order, source_type mapping). Seed: stock_footage, sports_edits (children: basketball, football, soccer, mma, f1), streamer_clips, dance_reels, podcast_reels, ai_ugc, ai_dance_reels.
- Add `subcategory_slug TEXT` + `category_id UUID` columns to `source_candidates`, backfill from existing `source_type` + `metadata.tags`.
- Add `view_clip_pool_counts` SQL view: `(user_id, category_id, subcategory_slug, count)` for instant UI counts.
- Add `auto_render` (bool) + `category_id` + `subcategory_slug` + `randomize` (bool) to `generation_batches`.
- Add RLS to new table.

**Phase 2 — Pool resolver + isolation enforcement** (shared lib + edge function)
- New `_shared/sources/pool.ts`: `selectClipPool({ category_id, subcategory_slug, randomize, filters })` — single chokepoint, all callers must go through it.
- Refactor `pick-stock-clip` + `_shared/sources/registry.ts` to require a `category_id`; no implicit fallback to other source_types.
- Add `stratifiedSample` for randomize mode.
- Unit tests asserting isolation: feed mixed pool → assert output IDs all share `category_id`.

**Phase 3 — Campaign Parameters UI**
- New `CategoryPicker` component (tree dropdown + thumbnail preview strip + filters drawer + live count).
- Replace the existing `SourceMode` selector inside `CampaignStep`.
- Add pool-size precheck: disable Generate unless `pool_count >= template.cut_markers.length`.

**Phase 4 — Instant render path** (the spec's key behavior)
- New edge function `library-remix`: takes `template_id` + current campaign params, immediately creates a `video_library_items` row with `status='generating'`, a `generation_items` row with `auto_render=true`, **does not create a `posts` row**.
- Modify `fanpage-generate-due` to honor the `auto_render` flag — finish the item to `status='ready'` and skip post creation.
- Add "Remix" button to lyric template cards (`LyricsHome` / `LyricsWizard`).
- Add "Generate Library" button to `CampaignStep` that calls `library-remix` N times.

**Phase 5 — Studio Ready lane + Library wiring**
- Filter `StudioReadyLibraryPanel` to `status='ready' AND post_id IS NULL` only.
- Add Realtime subscription on `video_library_items` for live status flips (currently polled).
- Wire drag-from-Ready-to-calendar to existing `library-schedule` (already opt-in).

**Phase 6 — Failure UI + E2E test**
- Pool-too-small inline error.
- Failed-render retry button (calls existing `recover_generation_items`).
- Playwright spec: seed 30 basketball candidates, 1 template w/ 8 shots, click Remix, poll until ready, assert all 8 `clip_ids_used` are basketball.

### Things I am NOT doing (and why)

- **Inngest / BullMQ.** This repo's queue is already `claim_generation_items` + cron-driven `fanpage-generate-due`. Adding a second queue is the wrong move — it would duplicate the existing worker loop and the cancellation logic you just stabilized.
- **Brand-new Remotion stack.** `render-karaoke` already exists and produces 9:16 MP4s with burn-in captions. I'll wire Remix to it, not rebuild.
- **Re-naming `source_candidates` → `clips`.** Migration cost is huge and every edge function would break. I'll keep storage names and expose "clips/categories" only at the API/UI layer.
- **Scraping pipeline.** Out of scope for this PR — ingestion already exists per source_type. I'll add a manual upload path for subcategories but not new scrapers.

### Open questions before I start Phase 1

1. **Should "Remix" replace the current scheduled-post flow, or coexist?** The spec says edits land as `ready_to_post` with no calendar slot. Today every batch slot books a `posts` row at a scheduled time. If I add `auto_render` mode, existing campaigns keep their behavior; new ones using the category picker get the instant-render behavior. OK?
2. **Subcategories: do you want them user-defined or hard-coded?** Spec hard-codes (basketball/football/soccer/mma/f1). I'll seed those and make the table extensible later.
3. **Randomize stratification key:** by `category_id` (parent) or by `(category_id, subcategory_slug)` leaves? Spec implies parent.

Reply with: "go phase 1" (and answers to the 3 questions) and I'll ship the migration. I will not start coding the full 6 phases in one shot — each phase is 200-600 LOC and needs verification before the next.