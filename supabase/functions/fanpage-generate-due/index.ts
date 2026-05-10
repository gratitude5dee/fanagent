// Cron worker: walks generation_items in `pending` whose batch is not paused.
// For each item, transcribes audio (once per batch), picks a stock clip, then
// dispatches a Remotion render. Stops at MAX_PER_RUN to keep latency bounded.
//
// Auth: requires x-cron-secret matching CRON_SECRET (also accepts authenticated
// service-role calls for manual triggering from the dashboard).

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import {
  endWorkerRun,
  isAuthorizedCronCall,
  startWorkerRun,
} from "../_shared/workers.ts";

const MAX_PER_RUN = 5;
const FUNCTION_NAME = "fanpage-generate-due";

function fnUrl(name: string): string {
  return `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
}

async function invokeChild(name: string, body: unknown): Promise<Response> {
  const serviceKey = optionalEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return fetch(fnUrl(name), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });
}

async function processItem(itemId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const item = await supabase
    .from("generation_items")
    .select("id,batch_id,provider")
    .eq("id", itemId)
    .single();
  if (item.error) throw item.error;

  // 1. Ensure transcript exists for the batch's audio asset.
  const batch = await supabase
    .from("generation_batches")
    .select("audio_asset_id")
    .eq("id", item.data.batch_id)
    .single();
  if (batch.error) throw batch.error;

  const audio = await supabase
    .from("media_assets")
    .select("id,transcript")
    .eq("id", batch.data.audio_asset_id)
    .single();
  if (audio.error) throw audio.error;

  if (!audio.data.transcript) {
    await supabase.from("generation_items").update({ status: "transcribing" })
      .eq("id", itemId);
    const t = await invokeChild("transcribe-audio", {
      audioAssetId: audio.data.id,
    });
    if (!t.ok) {
      const err = await t.text();
      throw new Error(`transcribe-audio failed: ${err}`);
    }
  }

  // 2. Pick stock clip (skip if seedance-only mode).
  if (item.data.provider !== "seedance") {
    const s = await invokeChild("pick-stock-clip", { itemId });
    if (!s.ok) {
      const err = await s.text();
      throw new Error(`pick-stock-clip failed: ${err}`);
    }
  }

  // 3. Dispatch render.
  const r = await invokeChild("render-karaoke", { itemId });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`render-karaoke failed: ${err}`);
  }
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;

  if (!isAuthorizedCronCall(request)) {
    return errorResponse("Unauthorized cron call", 401);
  }

  const runId = await startWorkerRun(FUNCTION_NAME);
  let processed = 0;
  let errors = 0;
  const errorList: Array<{ itemId: string; error: string }> = [];

  try {
    const supabase = getSupabaseAdmin();
    const due = await supabase
      .from("generation_items")
      .select("id, generation_batches!inner(paused_at)")
      .eq("status", "pending")
      .lte("scheduled_at", new Date(Date.now() + 60 * 60_000).toISOString())
      .is("generation_batches.paused_at", null)
      .order("scheduled_at", { ascending: true })
      .limit(MAX_PER_RUN);
    if (due.error) throw due.error;

    for (const row of due.data ?? []) {
      try {
        await processItem(row.id as string);
        processed += 1;
      } catch (err) {
        errors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        errorList.push({ itemId: row.id as string, error: msg });
        await supabase
          .from("generation_items")
          .update({ status: "failed", error_message: msg })
          .eq("id", row.id as string);
      }
    }

    await endWorkerRun(runId, processed, errors, { errors: errorList });
    return jsonResponse({ processed, errors, errorList });
  } catch (error) {
    await endWorkerRun(runId, processed, errors + 1, {
      fatal: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error);
  }
});
