// Generates a single Seedance text-to-video clip for one segment of an item
// and stores the resulting URL into generation_items.segments[i].url.
// Input: { itemId, segmentIndex }

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { generateSeedanceClip } from "../_shared/fal.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type Segment = {
  source: "stock" | "seedance";
  url?: string;
  prompt?: string;
};

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = await request.json() as { itemId?: string; segmentIndex?: number };
    if (!body.itemId) throw new Error("itemId required");
    const idx = Number(body.segmentIndex ?? 0);

    const supabase = getSupabaseAdmin();
    const item = await supabase.from("generation_items")
      .select("id,prompt,segments,input_payload")
      .eq("id", body.itemId).single();
    if (item.error) throw item.error;

    const segments = (item.data.segments ?? []) as Segment[];
    const seg = segments[idx];
    if (!seg) throw new Error(`Segment ${idx} missing`);
    const prompt = seg.prompt ?? item.data.prompt ?? "cinematic vertical shot";

    const url = await generateSeedanceClip(prompt);
    segments[idx] = { ...seg, url };

    const updated = await supabase.from("generation_items")
      .update({ segments, status: "generating" })
      .eq("id", body.itemId);
    if (updated.error) throw updated.error;

    return jsonResponse({ ok: true, itemId: body.itemId, segmentIndex: idx, url });
  } catch (error) {
    return errorResponse(error);
  }
});
