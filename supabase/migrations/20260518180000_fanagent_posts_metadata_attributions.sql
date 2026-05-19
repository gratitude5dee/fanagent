-- Persist scheduled-post metadata for source attribution and future platform fields.

alter table public.posts
  add column if not exists metadata jsonb not null default '{}'::jsonb;

with post_attributions as (
  select
    p.id as post_id,
    jsonb_agg(source_attributions.attribution order by source_attributions.attribution) as attributions
  from public.posts p
  join public.video_library_items vli on vli.id = p.library_item_id
  join lateral (
    select distinct btrim(attribution) as attribution
    from (
      select element->>'attribution' as attribution
      from jsonb_array_elements(coalesce(vli.provenance, '[]'::jsonb)) as element
      union all
      select element->>'attribution' as attribution
      from jsonb_array_elements(coalesce(vli.segments, '[]'::jsonb)) as element
    ) raw_attributions
    where btrim(coalesce(attribution, '')) <> ''
  ) source_attributions on true
  group by p.id
)
update public.posts p
set metadata = jsonb_set(p.metadata, '{attributions}', post_attributions.attributions, true)
from post_attributions
where p.id = post_attributions.post_id
  and jsonb_array_length(post_attributions.attributions) > 0;
