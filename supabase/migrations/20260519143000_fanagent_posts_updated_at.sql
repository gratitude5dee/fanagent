alter table public.posts
  add column if not exists updated_at timestamptz default now();

update public.posts
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

drop trigger if exists posts_touch_updated_at on public.posts;
create trigger posts_touch_updated_at
  before update on public.posts
  for each row execute function public.touch_updated_at();

comment on column public.posts.updated_at is
  'Tracks post lifecycle edits, including blocked publish rescans and calendar updates.';
