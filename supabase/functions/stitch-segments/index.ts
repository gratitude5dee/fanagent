// Stitches all segment URLs of an item end-to-end and overlays the batch's
// audio track via fal.ai ffmpeg-api/compose. Stores the final URL on
// generation_items.stock_clip_url (reused as final video) and marks the linked
// post ready to publish.

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { stitchClipsWithAudio } from "../_shared/fal.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type Segment = { source: string; url?: string; prompt?: string };

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = await request.json() as { itemId?: string };
    if (!body.itemId) throw new Error("itemId required");

    const supabase = getSupabaseAdmin();
    const item = await supabase.from("generation_items")
      .select("id,batch_id,segments,duration_seconds,lyric_template_id")
      .eq("id", body.itemId).single();
    if (item.error) throw item.error;

    const segments = (item.data.segments ?? []) as Segment[];
    if (segments.length === 0) throw new Error("No segments to stitch");
    const missing = segments.filter((s) => !s.url);
    if (missing.length) throw new Error(`${missing.length} segment(s) missing url`);

    const batch = await supabase.from("generation_batches")
      .select("audio_asset_id,lyric_template_id").eq("id", item.data.batch_id).single();
    if (batch.error) throw batch.error;

    const audio = await supabase.from("media_assets")
      .select("public_url").eq("id", batch.data.audio_asset_id).single();
    if (audio.error) throw audio.error;

    const total = item.data.duration_seconds ?? 15;

    // Pull cut markers from the resolved lyric template if any.
    const lyricTemplateId = item.data.lyric_template_id ?? batch.data.lyric_template_id ?? null;
    let markersSec: number[] = [];
    if (lyricTemplateId) {
      const lt = await supabase.from("kanvas_lyric_templates")
        .select("cut_markers,selection_start_ms")
        .eq("id", lyricTemplateId).maybeSingle();
      if (lt.data) {
        const startMs = lt.data.selection_start_ms ?? 0;
        markersSec = ((lt.data.cut_markers ?? []) as number[])
          .map((ms) => (ms - startMs) / 1000)
          .filter((s) => s > 0.1 && s < total - 0.1)
          .sort((a, b) => a - b);
      }
    }

    let finalUrl: string;
    if (segments.length === 1 && markersSec.length === 0) {
      // Single segment, no markers — skip ffmpeg, use as-is.
      finalUrl = segments[0].url!;
    } else {
      // Build per-clip durations either from markers (cuts) or even split.
      let clipUrls: string[];
      let segmentDurations: number[];
      if (segments.length === 1 && markersSec.length > 0) {
        // Repeat the same clip per cut segment so ffmpeg trims at marker boundaries.
        const cuts = [0, ...markersSec, total];
        clipUrls = new Array(cuts.length - 1).fill(segments[0].url!);
        segmentDurations = cuts.slice(1).map((t, i) => Math.max(0.5, t - cuts[i]));
      } else if (markersSec.length > 0 && markersSec.length + 1 === segments.length) {
        // Snap multi-segment boundaries to markers (±0.2s already implicit).
        const cuts = [0, ...markersSec, total];
        clipUrls = segments.map((s) => s.url!);
        segmentDurations = cuts.slice(1).map((t, i) => Math.max(0.5, t - cuts[i]));
      } else {
        const segSec = Math.max(1, Math.floor(total / segments.length));
        clipUrls = segments.map((s) => s.url!);
        segmentDurations = new Array(segments.length).fill(segSec);
      }
      const avgSeg = segmentDurations.reduce((a, b) => a + b, 0) / segmentDurations.length;
      finalUrl = await stitchClipsWithAudio({
        clipUrls,
        audioUrl: audio.data.public_url,
        segmentSeconds: Math.max(1, Math.round(avgSeg)),
        totalSeconds: total,
      });
    }

    const upd = await supabase.from("generation_items")
      .update({ stock_clip_url: finalUrl, status: "stitched" })
      .eq("id", body.itemId);
    if (upd.error) throw upd.error;

    return jsonResponse({ ok: true, itemId: body.itemId, url: finalUrl });
  } catch (error) {
    return errorResponse(error);
  }
});
