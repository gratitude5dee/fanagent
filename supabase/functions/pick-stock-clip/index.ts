// Picks a single best stock clip for a generation_item, caches it into
// stock-cache, and writes the cached signed URL back to
// generation_items.stock_clip_url.

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { cacheStockClip, searchStock } from "../_shared/stock.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = await request.json() as {
      itemId?: string;
      query?: string;
    };
    if (!body.itemId) throw new Error("itemId is required");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select("id,account_id,prompt,input_payload")
      .eq("id", body.itemId)
      .single();
    if (item.error) throw item.error;

    const query = body.query ??
      (item.data.input_payload as Record<string, unknown>)?.prompt as string ??
      item.data.prompt ?? "music aesthetic vertical";

    const candidates = await searchStock({
      accountId: item.data.account_id,
      query,
    });
    if (candidates.length === 0) {
      throw new Error(`No stock candidates for query: ${query}`);
    }
    const pick = candidates[0];
    const cachedUrl = await cacheStockClip(pick);

    const updated = await supabase
      .from("generation_items")
      .update({
        stock_clip_url: cachedUrl,
        status: "picking_stock",
      })
      .eq("id", body.itemId);
    if (updated.error) throw updated.error;

    return jsonResponse({
      itemId: body.itemId,
      provider: pick.provider,
      externalId: pick.externalId,
      durationSec: pick.durationSec,
      stockClipUrl: cachedUrl,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
