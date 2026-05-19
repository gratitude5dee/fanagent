-- Clear stale lock owner labels left behind by retryable worker errors.
-- The claim function only treats locked_at as authoritative, but stale locked_by
-- makes diagnostics and row inspection look blocked after retry scheduling.

update public.generation_items
set locked_by = null,
    updated_at = now()
where locked_at is null
  and locked_by is not null
  and status not in ('complete','failed','skipped');
