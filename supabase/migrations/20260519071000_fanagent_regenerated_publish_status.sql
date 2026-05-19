alter table public.posts
  drop constraint if exists posts_publish_status_check;

alter table public.posts
  add constraint posts_publish_status_check
  check (
    publish_status is null or publish_status in (
      'ready',
      'initializing',
      'uploading',
      'processing',
      'publish_complete',
      'failed',
      'retry_scheduled',
      'blocked_account_not_connected',
      'blocked_missing_privacy',
      'blocked_creator_restriction',
      'blocked_missing_video',
      'regenerated'
    )
  );
