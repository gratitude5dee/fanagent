-- Keep persisted source-candidate rights metadata inside the FanAgent v2 contract.

update public.source_candidates
set license = 'youtube_owner_provided',
    updated_at = now()
where source_type = 'sports_edit'
  and provider = 'youtube'
  and license in ('youtube_standard', 'youtube_creative_commons');

update public.source_candidates
set license = 'unknown',
    updated_at = now()
where license not in (
  'pexels',
  'pixabay',
  'user_library',
  'generated_seedance',
  'generated_gmi_seedance',
  'youtube_owner_provided',
  'twitch_creator_rights',
  'unknown'
);

alter table public.source_candidates
  drop constraint if exists source_candidates_license_check;

alter table public.source_candidates
  add constraint source_candidates_license_check
  check (
    license in (
      'pexels',
      'pixabay',
      'user_library',
      'generated_seedance',
      'generated_gmi_seedance',
      'youtube_owner_provided',
      'twitch_creator_rights',
      'unknown'
    )
  );
