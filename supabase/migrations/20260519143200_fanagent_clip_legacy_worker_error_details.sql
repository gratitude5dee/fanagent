update public.worker_runs
set detail = jsonb_set(
  detail,
  '{fatal}',
  to_jsonb(left(detail->>'fatal', 1200) || case when length(detail->>'fatal') > 1200 then '...' else '' end),
  true
)
where detail ? 'fatal'
  and length(detail->>'fatal') > 1200;

update public.worker_runs
set detail = jsonb_set(
  detail,
  '{fatalDetail,message}',
  to_jsonb(
    left(detail #>> '{fatalDetail,message}', 1200)
    || case when length(detail #>> '{fatalDetail,message}') > 1200 then '...' else '' end
  ),
  true
)
where detail #>> '{fatalDetail,message}' is not null
  and length(detail #>> '{fatalDetail,message}') > 1200;
