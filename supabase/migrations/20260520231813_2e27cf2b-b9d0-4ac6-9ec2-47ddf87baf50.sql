
CREATE TABLE public.clip_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.clip_categories(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  icon TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clip_categories_parent ON public.clip_categories(parent_id);
CREATE INDEX idx_clip_categories_source_type ON public.clip_categories(source_type);

ALTER TABLE public.clip_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clip_categories readable by all"
  ON public.clip_categories FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TRIGGER trg_clip_categories_updated
  BEFORE UPDATE ON public.clip_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.clip_categories (slug, name, source_type, icon, sort_order) VALUES
  ('stock_footage',    'Stock Footage',    'stock',         'film',     10),
  ('sports_edits',     'Sports Edits',     'sports_edit',   'trophy',   20),
  ('streamer_clips',   'Streamer Clips',   'streamer_clip', 'gamepad',  30),
  ('dance_reels',      'Dance Reels',      'stock',         'music',    40),
  ('podcast_reels',    'Podcast Reels',    'stock',         'mic',      50),
  ('ai_ugc',           'AI UGC',           'seedance',      'sparkles', 60),
  ('ai_dance_reels',   'AI Dance Reels',   'seedance',      'wand',     70);

INSERT INTO public.clip_categories (slug, name, parent_id, source_type, sort_order)
SELECT sub.sub_slug, sub.sub_name, p.id, 'sports_edit', sub.sub_order
FROM public.clip_categories p
CROSS JOIN (VALUES
  ('sports_edits_basketball', 'Basketball', 10),
  ('sports_edits_football',   'Football',   20),
  ('sports_edits_soccer',     'Soccer',     30),
  ('sports_edits_mma',        'MMA',        40),
  ('sports_edits_f1',         'F1',         50)
) AS sub(sub_slug, sub_name, sub_order)
WHERE p.slug = 'sports_edits';

ALTER TABLE public.source_candidates
  ADD COLUMN category_id UUID REFERENCES public.clip_categories(id) ON DELETE SET NULL,
  ADD COLUMN subcategory_slug TEXT;

CREATE INDEX idx_source_candidates_category ON public.source_candidates(account_id, category_id, subcategory_slug);

UPDATE public.source_candidates sc
SET category_id = cc.id
FROM public.clip_categories cc
WHERE cc.parent_id IS NULL
  AND cc.source_type = sc.source_type
  AND sc.category_id IS NULL;

CREATE OR REPLACE VIEW public.view_clip_pool_counts AS
SELECT
  account_id,
  category_id,
  subcategory_slug,
  count(*)::bigint AS clip_count
FROM public.source_candidates
WHERE category_id IS NOT NULL
  AND (expires_at IS NULL OR expires_at > now())
GROUP BY account_id, category_id, subcategory_slug;

ALTER TABLE public.generation_batches
  ADD COLUMN auto_render BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN category_id UUID REFERENCES public.clip_categories(id) ON DELETE SET NULL,
  ADD COLUMN subcategory_slug TEXT,
  ADD COLUMN randomize BOOLEAN NOT NULL DEFAULT false;
