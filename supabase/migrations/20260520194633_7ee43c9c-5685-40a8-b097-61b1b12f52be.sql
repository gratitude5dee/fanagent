
WITH cancelled_batches AS (
  UPDATE public.generation_batches
  SET
    status = 'failed',
    paused_at = COALESCE(paused_at, now()),
    completed_at = now(),
    error_message = COALESCE(error_message, 'cancelled by user'),
    settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
      'cancellation', jsonb_build_object(
        'cancelled_at', now(),
        'reason', 'user requested bulk cancel'
      )
    ),
    updated_at = now()
  WHERE status NOT IN ('complete','failed')
  RETURNING id
),
aborted_items AS (
  UPDATE public.generation_items gi
  SET
    status = 'failed',
    error_message = 'cancelled by user',
    locked_at = NULL,
    locked_by = NULL,
    stage_events = (
      CASE WHEN jsonb_typeof(COALESCE(gi.stage_events,'[]'::jsonb)) = 'array'
        THEN COALESCE(gi.stage_events,'[]'::jsonb)
        ELSE '[]'::jsonb END
    ) || jsonb_build_array(jsonb_build_object('stage','cancelled','at',now(),'reason','user requested bulk cancel')),
    updated_at = now()
  FROM cancelled_batches cb
  WHERE gi.batch_id = cb.id
    AND gi.status IN ('pending','planning','transcribing','sourcing','picking_stock','generating','rendering','stitched','ready')
  RETURNING gi.id
),
skipped_posts AS (
  UPDATE public.posts p
  SET
    status = 'skipped',
    publish_status = NULL,
    error_message = 'cancelled by user',
    updated_at = now()
  FROM cancelled_batches cb
  WHERE p.batch_id = cb.id
    AND p.status NOT IN ('posted','skipped')
    AND (p.publish_status IS NULL OR p.publish_status <> 'success')
  RETURNING p.id
)
SELECT
  (SELECT count(*) FROM cancelled_batches) AS batches_cancelled,
  (SELECT count(*) FROM aborted_items) AS items_aborted,
  (SELECT count(*) FROM skipped_posts) AS posts_skipped;
