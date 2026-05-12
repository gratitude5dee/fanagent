-- FanAgent reliability pass:
-- - normalize public source modes to stock/mixed/seedance/gmi_seedance
-- - support larger campaigns with queue claiming + retry metadata
-- - add partial indexes for due generation/publishing scans

update public.generation_batches
set source_mode = 'mixed', updated_at = now()
where source_mode = 'hybrid';

update public.generation_batches
set source_mode = 'stock', updated_at = now()
where source_mode = 'remote_render';

update public.generation_items
set provider = 'mixed', updated_at = now()
where provider = 'hybrid';

update public.generation_items
set provider = 'stock', updated_at = now()
where provider = 'remote_render';

alter table public.generation_batches
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists publish_defaults jsonb not null default '{}'::jsonb;

alter table public.generation_items
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists stage_events jsonb not null default '[]'::jsonb;

alter table public.generation_batches
  drop constraint if exists valid_generation_batch_source;

alter table public.generation_batches
  add constraint valid_generation_batch_source
  check (source_mode in ('stock','mixed','seedance','gmi_seedance'));

alter table public.generation_items
  drop constraint if exists valid_generation_item_status;

alter table public.generation_items
  add constraint valid_generation_item_status
  check (
    status in (
      'pending',
      'planning',
      'transcribing',
      'picking_stock',
      'generating',
      'rendering',
      'stitched',
      'ready',
      'complete',
      'failed',
      'skipped'
    )
  );

create index if not exists idx_generation_items_due_claim
  on public.generation_items (scheduled_at, created_at)
  where status in ('pending','planning','transcribing','picking_stock','generating','rendering','stitched','ready');

create index if not exists idx_generation_items_unlocked_retry
  on public.generation_items (locked_at, attempt_count)
  where status not in ('complete','failed','skipped');

create index if not exists idx_posts_due_publish_private
  on public.posts (account_id, scheduled_at)
  where status = 'pending'
    and video_url is not null
    and tiktok_privacy_level is not null;

create or replace function public.claim_generation_items(
  p_limit integer default 5,
  p_worker_id text default null,
  p_claim_window_minutes integer default 15
)
returns setof public.generation_items
language sql
security invoker
set search_path = public
as $$
  with candidates as (
    select gi.id
    from public.generation_items gi
    join public.generation_batches gb on gb.id = gi.batch_id
    where gi.status in (
        'pending',
        'planning',
        'transcribing',
        'picking_stock',
        'generating',
        'rendering',
        'stitched',
        'ready'
      )
      and gi.scheduled_at <= now() + interval '60 minutes'
      and gb.paused_at is null
      and coalesce(gi.attempt_count, 0) < coalesce(gi.max_attempts, 3)
      and (
        gi.locked_at is null
        or gi.locked_at < now() - make_interval(mins => greatest(1, p_claim_window_minutes))
      )
    order by gi.scheduled_at asc, gi.created_at asc
    limit greatest(1, least(coalesce(p_limit, 5), 50))
    for update of gi skip locked
  ),
  updated as (
    update public.generation_items gi
    set
      locked_at = now(),
      locked_by = coalesce(nullif(p_worker_id, ''), 'fanpage-generate-due'),
      last_attempt_at = now(),
      attempt_count = coalesce(gi.attempt_count, 0) + 1,
      status = case when gi.status = 'pending' then 'planning' else gi.status end,
      updated_at = now()
    from candidates
    where gi.id = candidates.id
    returning gi.*
  )
  select * from updated;
$$;

revoke all on function public.claim_generation_items(integer, text, integer) from public;
revoke all on function public.claim_generation_items(integer, text, integer) from anon;
revoke all on function public.claim_generation_items(integer, text, integer) from authenticated;
grant execute on function public.claim_generation_items(integer, text, integer) to service_role;

comment on function public.claim_generation_items(integer, text, integer)
  is 'Atomically claims due FanAgent generation queue rows for service-role workers using FOR UPDATE SKIP LOCKED.';

-- Cron examples after deploying functions and storing secrets in Vault:
-- select vault.create_secret('https://zjbiulirzrctfmakqjwk.supabase.co', 'fanagent_project_url');
-- select vault.create_secret('<cron-secret>', 'fanagent_cron_secret');
-- select cron.schedule(
--   'fanagent-generate-due',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'fanagent_project_url') || '/functions/v1/fanpage-generate-due',
--     headers := jsonb_build_object(
--       'Content-type', 'application/json',
--       'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fanagent_cron_secret')
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
-- select cron.schedule(
--   'fanagent-publish-due',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'fanagent_project_url') || '/functions/v1/fanpage-publish-due',
--     headers := jsonb_build_object(
--       'Content-type', 'application/json',
--       'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fanagent_cron_secret')
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
