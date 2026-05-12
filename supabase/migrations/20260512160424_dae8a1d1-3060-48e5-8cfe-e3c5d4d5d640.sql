update public.generation_items
set status = 'pending', error_message = null, updated_at = now()
where status = 'failed'
  and provider = 'stock'
  and error_message ilike '%GMI_API_KEY%';