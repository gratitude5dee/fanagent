update public.video_library_items
set
  metadata = coalesce(metadata, '{}'::jsonb) - 'failed' - 'failure_error' - 'failed_at',
  updated_at = now()
where status in ('ready', 'scheduled', 'posted')
  and (
    coalesce(metadata, '{}'::jsonb) ? 'failed'
    or coalesce(metadata, '{}'::jsonb) ? 'failure_error'
    or coalesce(metadata, '{}'::jsonb) ? 'failed_at'
  );
