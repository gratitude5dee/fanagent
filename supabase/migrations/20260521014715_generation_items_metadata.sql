alter table public.generation_items
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_generation_items_metadata_gin
  on public.generation_items using gin (metadata);

