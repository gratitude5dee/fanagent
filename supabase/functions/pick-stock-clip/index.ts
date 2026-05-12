// Plans segments for a generation_item based on the batch's duration and source
// mode, then fills the `stock` segments with cached stock clip URLs.
// `seedance` segments are left with a prompt and url=null for the seedance worker.
// Writes back to generation_items.segments. Status:
//   - all-stock & filled → "picking_stock" (orchestrator will skip directly to stitch)
//   - mixed/seedance with pending segments → "planning" (orchestrator dispatches seedance)

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { cacheStockClip, searchStock } from "../_shared/stock.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type Segment = { source: "stock" | "seedance"; url?: string; prompt?: string };

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = await request.json() as { itemId?: string };
    if (!body.itemId) throw new Error("itemId is required");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select("id,account_id,batch_id,prompt,input_payload,duration_seconds")
      .eq("id", body.itemId).single();
    if (item.error) throw item.error;

    const batch = await supabase.from("generation_batches")
      .select("source_mode,duration_seconds")
      .eq("id", item.data.batch_id).single();
    if (batch.error) throw batch.error;

    const total = Number(item.data.duration_seconds ?? batch.data.duration_seconds ?? 15);
    const segCount = Math.max(1, Math.ceil(total / 15));
    const sourceMode = (batch.data.source_mode ?? "stock") as "stock" | "seedance" | "mixed";

    const prompt = item.data.prompt ?? "music aesthetic vertical";

    // Decide source per segment.
    const sources: Array<"stock" | "seedance"> = Array.from({ length: segCount }, (_, i) => {
      if (sourceMode === "stock") return "stock";
      if (sourceMode === "seedance") return "seedance";
      // mixed: alternate
      return i % 2 === 0 ? "stock" : "seedance";
    });

    // Fill stock segments by ranking candidates and rotating through them.
    let stockCandidates: Awaited<ReturnType<typeof searchStock>> = [];
    if (sources.includes("stock")) {
      stockCandidates = await searchStock({ accountId: item.data.account_id, query: prompt });
      if (stockCandidates.length === 0 && sourceMode === "stock") {
        throw new Error(`No stock candidates for prompt: ${prompt}`);
      }
    }

    const segments: Segment[] = [];
    let stockIdx = 0;
    for (const src of sources) {
      if (src === "stock" && stockCandidates.length > 0) {
        const pick = stockCandidates[stockIdx % stockCandidates.length];
        stockIdx += 1;
        const url = await cacheStockClip(pick);
        segments.push({ source: "stock", url });
      } else {
        // Seedance segment — write prompt, leave url empty.
        segments.push({ source: "seedance", prompt });
      }
    }

    const allFilled = segments.every((s) => !!s.url);
    const updated = await supabase.from("generation_items")
      .update({
        segments,
        stock_clip_url: segments[0]?.url ?? null,
        status: allFilled ? "picking_stock" : "planning",
      })
      .eq("id", body.itemId);
    if (updated.error) throw updated.error;

    return jsonResponse({
      ok: true, itemId: body.itemId, segments, allFilled,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
