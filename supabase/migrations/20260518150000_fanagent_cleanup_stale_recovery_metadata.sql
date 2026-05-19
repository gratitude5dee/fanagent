-- Clean up stale metadata left by pre-RPC recovery/worker requests that hit the
-- edge runtime timeout after their child work had already finished.

update public.generation_items
set
  error_message = null,
  locked_at = null,
  locked_by = null,
  updated_at = now()
where status = 'complete'
  and (
    error_message is not null
    or locked_at is not null
    or locked_by is not null
  );

update public.worker_runs
set
  ended_at = now(),
  detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object(
    'recovered_stale_open_run',
    true,
    'recovered_at',
    now()
  )
where ended_at is null
  and started_at < now() - interval '10 minutes';
