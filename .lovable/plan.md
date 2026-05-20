# Cancel all generation jobs / active campaigns

There are 30+ `generation_batches` still active (mix of `pending`, `generating`, `paused`). The dashboard pause UI only sets `paused_at`; workers still hold leases and many `generation_items` remain in active states. To truly stop everything, we need to mark batches as cancelled, abort their child `generation_items`, and skip any unpublished `posts` they spawned.

## Scope

A single SQL migration that:

1. **Pause + cancel batches** — for every `generation_batches` row not already `complete`/`failed`/`cancelled`:
   - Set `status = 'cancelled'`
   - Set `paused_at = now()` (if null)
   - Set `completed_at = now()`
   - Append a note to `settings.cancellation` for audit
2. **Abort in-flight generation_items** — for items belonging to those batches whose `status` is in (`pending`, `planning`, `transcribing`, `sourcing`, `picking_stock`, `generating`, `rendering`, `stitched`, `ready`):
   - Set `status = 'failed'`
   - Set `error_message = 'cancelled by user'`
   - Clear `locked_at`, `locked_by`
   - Append a `cancelled` entry to `stage_events`
3. **Skip unpublished posts** — for `posts` linked to those batches where `status NOT IN ('posted','skipped')` and `publish_status IS NULL OR publish_status <> 'success'`:
   - Set `status = 'skipped'`, `publish_status = null`, `error_message = 'cancelled by user'`
4. **Mark library items not-ready** — for `video_library_items` linked to those batches whose `status` is `building`/`not_ready`/`ready` but never `scheduled`/`posted`:
   - Leave `ready` items alone (already usable assets), but set any `building`/`not_ready` row to `cancelled` via `metadata.cancelled_at` flag so the worker doesn't pick them up.

No code/UI changes; this is a one-shot data cleanup. Workers (`fanpage-generate-due`, `process-generation-due`, `fanpage-publish-due`) already respect `paused_at`/non-active statuses, so they will stop touching these rows immediately.

## Confirm before I run

A few choices to confirm:

1. **Scope** — cancel **all** non-terminal batches across **all accounts**? (Alternative: only your currently logged-in account, or only the ones created today.)
2. **Ready library items** — keep already-rendered videos in the library so you can still schedule/post them manually? (Recommended: yes.)
3. **Unpublished scheduled posts** — skip them all, even ones scheduled for the future? (Recommended: yes, since they belong to cancelled batches.)

Reply with answers (or "yes to all defaults") and I'll run the migration.
