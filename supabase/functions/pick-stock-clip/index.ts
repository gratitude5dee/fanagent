// Plans segments for a generation_item based on the batch's duration and source
// mode, then fills the `stock` segments with cached stock clip URLs.
// `seedance` segments are left with a prompt and url=null for the seedance worker.
// Writes back to generation_items.segments. Status:
//   - all-stock & filled → "picking_stock" (orchestrator will skip directly to stitch)
//   - mixed/seedance with pending segments → "planning" (orchestrator dispatches seedance)

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  collectUsedStockKeys,
  createSegmentVisualPlan,
  createStockSegment,
  normalizeSourceMode,
  selectStockCandidate,
  stockIdentityKeys,
} from "../_shared/generation.ts";
import { cacheStockClip, searchStock, type StockSettings } from "../_shared/stock.ts";
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

function transcriptText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  const transcript = value as Record<string, unknown>;
  const words = Array.isArray(transcript.words) ? transcript.words : [];
  if (words.length > 0) {
    return words
      .map((word) => {
        if (typeof word === "string") return word;
        if (!word || typeof word !== "object") return "";
        const record = word as Record<string, unknown>;
        return String(record.text ?? record.word ?? "");
      })
      .filter(Boolean)
      .join(" ");
  }
  const blocks = Array.isArray(transcript.blocks) ? transcript.blocks : [];
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      return String((block as Record<string, unknown>).text ?? "");
    })
    .filter(Boolean)
    .join(" ");
}

function transcriptSnippet(value: unknown, itemIndex: number, segmentIndex: number): string {
  const words = transcriptText(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const start = (itemIndex * 17 + segmentIndex * 11) % words.length;
  return [...words, ...words].slice(start, start + 14).join(" ");
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await request.json()) as { itemId?: string };
    if (!body.itemId) throw new Error("itemId is required");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select("id,account_id,batch_id,item_index,prompt,input_payload,duration_seconds")
      .eq("id", body.itemId)
      .single();
    if (item.error) throw item.error;

    const batch = await supabase
      .from("generation_batches")
      .select("source_mode,duration_seconds,settings,audio_asset_id")
      .eq("id", item.data.batch_id)
      .single();
    if (batch.error) throw batch.error;

    const total = Number(item.data.duration_seconds ?? batch.data.duration_seconds ?? 15);
    const segCount = Math.max(1, Math.ceil(total / 15));
    const segmentDuration = Math.max(1, Math.min(15, Math.ceil(total / segCount)));
    const sourceMode = normalizeSourceMode(batch.data.source_mode);

    const prompt = item.data.prompt ?? "music aesthetic vertical";
    const payload = (item.data.input_payload ?? {}) as Record<string, unknown>;
    const batchSettings = (batch.data.settings ?? {}) as Record<string, unknown>;
    const stockSettings = {
      ...((batchSettings.stock ?? {}) as Record<string, unknown>),
      ...((payload.stock_settings ?? {}) as Record<string, unknown>),
      minDurationSec: Math.min(15, total),
    } as StockSettings;

    const priorItems = await supabase
      .from("generation_items")
      .select("segments,stock_clip_url")
      .eq("batch_id", item.data.batch_id)
      .lt("item_index", item.data.item_index ?? 0)
      .order("item_index", { ascending: true });
    if (priorItems.error) throw priorItems.error;

    const usedStockKeys = collectUsedStockKeys(priorItems.data ?? []);

    const audio = batch.data.audio_asset_id
      ? await supabase
          .from("media_assets")
          .select("transcript")
          .eq("id", batch.data.audio_asset_id)
          .maybeSingle()
      : null;
    if (audio?.error) throw audio.error;
    const transcript = audio?.data?.transcript ?? null;

    // Decide source per segment.
    const sources: Array<"stock" | "seedance"> = Array.from({ length: segCount }, (_, i) => {
      if (sourceMode === "stock") return "stock";
      if (sourceMode === "seedance") return "seedance";
      // mixed: alternate
      return i % 2 === 0 ? "stock" : "seedance";
    });

    const segments: Segment[] = [];
    for (let segmentIndex = 0; segmentIndex < sources.length; segmentIndex += 1) {
      const src = sources[segmentIndex];
      const visualPlan = createSegmentVisualPlan({
        basePrompt: prompt,
        itemIndex: Number(item.data.item_index ?? 0),
        segmentIndex,
        totalSegments: segCount,
        durationSeconds: segmentDuration,
        transcriptContext: transcriptSnippet(
          transcript,
          Number(item.data.item_index ?? 0),
          segmentIndex,
        ),
      });

      if (src === "stock") {
        const stockCandidates = await searchStock({
          accountId: item.data.account_id,
          query: visualPlan.query,
          settings: stockSettings,
        });
        const selected = selectStockCandidate(stockCandidates, usedStockKeys, {
          avoidReuseWithinBatch: stockSettings.avoidReuseWithinBatch !== false,
          allowReuseWhenExhausted: stockSettings.allowReuseWhenExhausted !== false,
        });

        if (selected) {
          const url = await cacheStockClip(selected.candidate);
          segments.push(
            createStockSegment({
              clip: selected.candidate,
              url,
              query: visualPlan.query,
              reused: selected.reused,
            }) as Segment,
          );
          for (const key of stockIdentityKeys(selected.candidate)) usedStockKeys.add(key);
          usedStockKeys.add(url);
          continue;
        }

        if (sourceMode === "stock") {
          throw new Error(`No stock candidates for prompt: ${visualPlan.query}`);
        }
      }

      segments.push({
        source: "seedance",
        prompt: visualPlan.prompt,
        query: visualPlan.query,
        durationSec: segmentDuration,
        reused: false,
      });
    }

    const allFilled = segments.every((s) => !!s.url);
    const updated = await supabase
      .from("generation_items")
      .update({
        segments,
        stock_clip_url: segments[0]?.url ?? null,
        status: allFilled ? "picking_stock" : "planning",
      })
      .eq("id", body.itemId);
    if (updated.error) throw updated.error;

    return jsonResponse({
      ok: true,
      itemId: body.itemId,
      segments,
      allFilled,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
