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
    const body = (await request.json()) as { itemId?: string };
    if (!body.itemId) throw new Error("itemId required");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select("id,batch_id,segments,duration_seconds")
      .eq("id", body.itemId)
      .single();
    if (item.error) throw item.error;

    const segments = (item.data.segments ?? []) as Segment[];
    if (segments.length === 0) throw new Error("No segments to stitch");
    const missing = segments.filter((s) => !s.url);
    if (missing.length) throw new Error(`${missing.length} segment(s) missing url`);

    const batch = await supabase
      .from("generation_batches")
      .select("audio_asset_id")
      .eq("id", item.data.batch_id)
      .single();
    if (batch.error) throw batch.error;

    const audio = await supabase
      .from("media_assets")
      .select("public_url")
      .eq("id", batch.data.audio_asset_id)
      .single();
    if (audio.error) throw audio.error;

    const total = item.data.duration_seconds ?? 15;

    // Keep worker renders bounded: lyric cut markers are still used later for
    // captions, but stitching uses an even split so the worker can stay on the
    // faster merge path instead of a long marker-heavy compose timeline.
    const segSec = Math.max(1, Math.floor(total / segments.length));
    const clipUrls = segments.map((s) => s.url!);
    const segmentDurations = new Array(segments.length).fill(segSec);
    const avgSeg = segmentDurations.reduce((a, b) => a + b, 0) / segmentDurations.length;
    const finalUrl = await stitchClipsWithAudio({
      clipUrls,
      audioUrl: audio.data.public_url,
      segmentSeconds: Math.max(1, Math.round(avgSeg)),
      totalSeconds: total,
    });

    const upd = await supabase
      .from("generation_items")
      .update({ stock_clip_url: finalUrl, status: "stitched" })
      .eq("id", body.itemId);
    if (upd.error) throw upd.error;

    return jsonResponse({ ok: true, itemId: body.itemId, url: finalUrl });
  } catch (error) {
    return errorResponse(error);
  }
});
