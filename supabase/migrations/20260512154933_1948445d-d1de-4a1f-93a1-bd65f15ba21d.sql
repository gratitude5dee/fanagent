ALTER TABLE public.generation_batches ADD COLUMN IF NOT EXISTS lyric_template_id uuid NULL;
ALTER TABLE public.generation_items ADD COLUMN IF NOT EXISTS lyric_template_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_generation_batches_lyric_template_id ON public.generation_batches(lyric_template_id);
CREATE INDEX IF NOT EXISTS idx_generation_items_lyric_template_id ON public.generation_items(lyric_template_id);