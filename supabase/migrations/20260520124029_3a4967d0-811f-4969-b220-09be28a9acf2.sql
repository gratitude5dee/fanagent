ALTER TABLE public.video_library_items DROP CONSTRAINT IF EXISTS video_library_items_audio_clip_id_library_index_key;
CREATE UNIQUE INDEX IF NOT EXISTS video_library_items_batch_id_library_index_key
  ON public.video_library_items (batch_id, library_index)
  WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS video_library_items_audio_clip_id_idx
  ON public.video_library_items (audio_clip_id);