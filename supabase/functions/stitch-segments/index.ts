// Stitches all segment URLs of an item end-to-end and overlays the batch's
// audio track via fal.ai ffmpeg-api/compose. Stores the final URL on
// generation_items.stock_clip_url (reused as final video) and marks the linked
// post ready to publish.

import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { resolveMediaAssetUrl } from "../_shared/assets.ts";
import {
  composeClipsWithAudio,
  isFalIdleTimeout,
  mergeAudioVideo,
  stitchClipsWithAudio,
} from "../_shared/fal.ts";
import { isAuthorizedInternalCall } from "../_shared/internal.ts";
import { withRenderAttempt } from "../_shared/render-attempts.ts";
import { segmentDurationsFromCutMarkers } from "../_shared/stitch-plan.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type Segment = {
  source: string;
  url?: string;
  prompt?: string;
  provider?: string | null;
  externalId?: string | null;
  reused?: boolean | null;
};

function cutMarkers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((marker) => Number(marker)).filter((marker) => Number.isFinite(marker));
}

async function markerSegmentDurations(input: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  itemLyricTemplateId?: string | null;
  batchLyricTemplateId?: string | null;
  segmentCount: number;
  totalSeconds: number;
}): Promise<{ durations: number[]; lyricTemplateId: string; cutMarkersMs: number[] } | null> {
  const lyricTemplateId = input.itemLyricTemplateId ?? input.batchLyricTemplateId;
  if (!lyricTemplateId) return null;

  const template = await input.supabase
    .from("kanvas_lyric_templates")
    .select("id,cut_markers")
    .eq("id", lyricTemplateId)
    .maybeSingle();
  if (template.error) throw template.error;

  const cutMarkersMs = cutMarkers(template.data?.cut_markers);
  const durations = segmentDurationsFromCutMarkers({
    cutMarkersMs,
    segmentCount: input.segmentCount,
    totalSeconds: input.totalSeconds,
  });
  return durations ? { durations, lyricTemplateId, cutMarkersMs } : null;
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") {
    return errorEnvelope("Method not allowed", "METHOD_NOT_ALLOWED", 405);
  }
  if (!isAuthorizedInternalCall(request)) {
    return errorEnvelope("Unauthorized internal call.", "UNAUTHORIZED_INTERNAL", 401);
  }

  try {
    const body = (await request.json()) as { itemId?: string };
    if (!body.itemId) throw new Error("itemId required");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select("id,batch_id,segments,duration_seconds,lyric_template_id")
      .eq("id", body.itemId)
      .single();
    if (item.error) throw item.error;

    const segments = (item.data.segments ?? []) as Segment[];
    if (segments.length === 0) throw new Error("No segments to stitch");
    const missing = segments.filter((s) => !s.url);
    if (missing.length) throw new Error(`${missing.length} segment(s) missing url`);

    const batch = await supabase
      .from("generation_batches")
      .select("audio_asset_id,lyric_template_id")
      .eq("id", item.data.batch_id)
      .single();
    if (batch.error) throw batch.error;

    const audio = await supabase
      .from("media_assets")
      .select("public_url,storage_bucket,storage_path")
      .eq("id", batch.data.audio_asset_id)
      .single();
    if (audio.error) throw audio.error;
    const audioUrl = await resolveMediaAssetUrl(audio.data);
    if (!audioUrl) throw new Error("Batch audio asset is missing a renderable URL.");

    const total = item.data.duration_seconds ?? 15;

    const segSec = Math.max(1, Math.floor(total / segments.length));
    const clipUrls = segments.map((s) => s.url!);
    const markerTiming = await markerSegmentDurations({
      supabase,
      itemLyricTemplateId: item.data.lyric_template_id,
      batchLyricTemplateId: batch.data.lyric_template_id,
      segmentCount: clipUrls.length,
      totalSeconds: total,
    });
    const segmentDurations = markerTiming?.durations ?? new Array(segments.length).fill(segSec);
    const avgSeg = segmentDurations.reduce((a, b) => a + b, 0) / segmentDurations.length;
    const render = await withRenderAttempt(
      {
        generationItemId: body.itemId,
        stage: "stitch",
        provider: "fal_ffmpeg",
        detail: {
          action: "stitch-segments",
          segment_count: clipUrls.length,
          total_seconds: total,
          segment_seconds: Math.max(1, Math.round(avgSeg)),
          segment_durations: segmentDurations,
          stitch_timing: markerTiming ? "cut_markers" : "even_split",
          lyric_template_id: markerTiming?.lyricTemplateId ?? null,
          cut_markers_ms: markerTiming?.cutMarkersMs ?? [],
          audio_bucket: audio.data.storage_bucket ?? null,
          idempotency_key: `${body.itemId}:stitch`,
        },
      },
      async () => {
        let finalUrl: string;
        let stitchMode = "full";
        if (clipUrls.length === 1) {
          const merged = await mergeAudioVideo(clipUrls[0], audioUrl);
          return { finalUrl: merged.url, stitchMode: "single_segment_merge" };
        }
        if (markerTiming) {
          try {
            finalUrl = await composeClipsWithAudio({
              clipUrls,
              audioUrl,
              segmentDurations,
              totalSeconds: total,
            });
            return { finalUrl, stitchMode: "marker_compose" };
          } catch (error) {
            if (!isFalIdleTimeout(error)) throw error;
            const fallback = await mergeAudioVideo(clipUrls[0], audioUrl);
            return {
              finalUrl: fallback.url,
              stitchMode: "single_visual_marker_timeout_fallback",
            };
          }
        }
        try {
          finalUrl = await stitchClipsWithAudio({
            clipUrls,
            audioUrl,
            segmentSeconds: Math.max(1, Math.round(avgSeg)),
            totalSeconds: total,
          });
        } catch (error) {
          if (!isFalIdleTimeout(error) || clipUrls.length < 2) throw error;
          const fallback = await mergeAudioVideo(clipUrls[0], audioUrl);
          finalUrl = fallback.url;
          stitchMode = "single_visual_timeout_fallback";
        }
        return { finalUrl, stitchMode };
      },
    );

    const upd = await supabase
      .from("generation_items")
      .update({
        stock_clip_url: render.finalUrl,
        status: "stitched",
        segments: segments.map((segment, index) => ({
          ...segment,
          stitchSelected:
            render.stitchMode === "full" || render.stitchMode === "marker_compose" || index === 0,
          stitchDurationSec: segmentDurations[index] ?? null,
        })),
      })
      .eq("id", body.itemId);
    if (upd.error) throw upd.error;

    return okEnvelope({
      itemId: body.itemId,
      url: render.finalUrl,
      stitchMode: render.stitchMode,
    });
  } catch (error) {
    return errorEnvelope(error, "STITCH_SEGMENTS_FAILED", 500);
  }
});
