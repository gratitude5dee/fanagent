// Generates a single Seedance text-to-video clip for one segment of an item
// and stores the resulting URL into generation_items.segments[i].url.
// Input: { itemId, segmentIndex }

import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { generateSeedanceClip } from "../_shared/fal.ts";
import { isAuthorizedInternalCall } from "../_shared/internal.ts";
import { withRenderAttempt } from "../_shared/render-attempts.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type Segment = {
  source: "stock" | "seedance";
  url?: string;
  prompt?: string;
  provider?: string | null;
  externalId?: string | null;
  query?: string | null;
  durationSec?: number | null;
  reused?: boolean | null;
};

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
    const body = (await request.json()) as { itemId?: string; segmentIndex?: number };
    if (!body.itemId) throw new Error("itemId required");
    const idx = Number(body.segmentIndex ?? 0);

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select("id,prompt,segments,input_payload,duration_seconds")
      .eq("id", body.itemId)
      .single();
    if (item.error) throw item.error;

    const segments = (item.data.segments ?? []) as Segment[];
    const seg = segments[idx];
    if (!seg) throw new Error(`Segment ${idx} missing`);
    const prompt = seg.prompt ?? item.data.prompt ?? "cinematic vertical shot";
    const payload = (item.data.input_payload ?? {}) as Record<string, unknown>;
    const seedanceSettings = (payload.seedance_settings ?? {}) as Record<string, unknown>;
    const durationSeconds = Math.min(
      15,
      Number(seg.durationSec ?? item.data.duration_seconds ?? 15),
    );

    const resolution =
      seedanceSettings.resolution === "480p" || seedanceSettings.resolution === "1080p"
        ? seedanceSettings.resolution
        : "720p";
    const url = await withRenderAttempt(
      {
        generationItemId: body.itemId,
        stage: "sourcing",
        provider: "fal_seedance",
        detail: {
          action: "generate-seedance-clip",
          segment_index: idx,
          duration_seconds: durationSeconds,
          resolution,
        },
      },
      () => generateSeedanceClip(prompt, { durationSeconds, resolution }),
    );
    segments[idx] = { ...seg, url };

    const updated = await supabase
      .from("generation_items")
      .update({ segments, status: "generating" })
      .eq("id", body.itemId);
    if (updated.error) throw updated.error;

    return okEnvelope({ itemId: body.itemId, segmentIndex: idx, url });
  } catch (error) {
    return errorEnvelope(error, "GENERATE_SEEDANCE_CLIP_FAILED", 500);
  }
});
