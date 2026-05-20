alter table public.kanvas_lyric_templates
  add column if not exists audio_clip_id uuid;
create index if not exists kanvas_lyric_templates_audio_clip_id_idx
  on public.kanvas_lyric_templates(audio_clip_id);

alter table public.audio_clips
  add column if not exists lyric_template_id uuid;
create index if not exists audio_clips_lyric_template_id_idx
  on public.audio_clips(lyric_template_id);