
ALTER TABLE public.generation_batches
  ADD COLUMN IF NOT EXISTS duration_seconds integer NOT NULL DEFAULT 15;

ALTER TABLE public.generation_items
  ADD COLUMN IF NOT EXISTS segments jsonb,
  ADD COLUMN IF NOT EXISTS stitched_asset_id uuid;
