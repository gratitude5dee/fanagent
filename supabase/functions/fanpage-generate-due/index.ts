// Cron worker: walks generation_items in `pending` whose batch is not paused.
// Per item:
//   1. Ensure the batch's audio asset has a transcript.
//   2. Plan segments (pick-stock-clip writes generation_items.segments based on
//      duration + source_mode).
//   3. Generate any seedance segments (generate-seedance-clip).
//   4. When all segments have urls, stitch them with the audio (stitch-segments)
//      — single-segment case is a passthrough.
// Stops at MAX_PER_RUN to keep latency bounded.

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { endWorkerRun, isAuthorizedCronCall, startWorkerRun } from "../_shared/workers.ts";

const MAX_PER_RUN = 5;
const FUNCTION_NAME = "fanpage-generate-due";

type Segment = { source: "stock" | "seedance"; url?: string; prompt?: string };

function fnUrl(name: string): string {
  return `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
}

async function invokeChild(name: string, body: unknown): Promise<Response> {
  const serviceKey = optionalEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return fetch(fnUrl(name), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify(body),
  });
}

async function ok(res: Response, label: string) {
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${label} failed [${res.status}]: ${err.slice(0, 300)}`);
  }
}

async function processItem(itemId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const item = await supabase.from("generation_items")
    .select("id,batch_id,segments,status").eq("id", itemId).single();
  if (item.error) throw item.error;

  const batch = await supabase.from("generation_batches")
    .select("audio_asset_id").eq("id", item.data.batch_id).single();
  if (batch.error) throw batch.error;

  const audio = await supabase.from("media_assets")
    .select("id,transcript").eq("id", batch.data.audio_asset_id).single();
  if (audio.error) throw audio.error;

  // 1. Transcript.
  if (!audio.data.transcript) {
    await supabase.from("generation_items").update({ status: "transcribing" }).eq("id", itemId);
    await ok(await invokeChild("transcribe-audio", { audioAssetId: audio.data.id }), "transcribe-audio");
  }

  // 2. Plan segments if not already.
  let segments = (item.data.segments ?? []) as Segment[];
  if (segments.length === 0) {
    await ok(await invokeChild("pick-stock-clip", { itemId }), "pick-stock-clip");
    const reload = await supabase.from("generation_items")
      .select("segments").eq("id", itemId).single();
    segments = (reload.data?.segments ?? []) as Segment[];
  }

  // 3. Generate seedance segments.
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    if (s.source === "seedance" && !s.url) {
      await ok(
        await invokeChild("generate-seedance-clip", { itemId, segmentIndex: i }),
        `generate-seedance-clip[${i}]`,
      );
    }
  }

  // 4. Stitch (or passthrough) → status='stitched'.
  await ok(await invokeChild("stitch-segments", { itemId }), "stitch-segments");

  // 5. Final render: burn captions if a lyric template is attached → status='ready'.
  await ok(await invokeChild("render-karaoke", { itemId }), "render-karaoke");

  // 6. Create the post row so the publisher worker picks it up.
  await createPostForItem(itemId);
}

async function createPostForItem(itemId: string) {
  const supabase = getSupabaseAdmin();
  const item = await supabase.from("generation_items")
    .select("id,account_id,batch_id,scheduled_at,final_asset_id,input_payload,post_id")
    .eq("id", itemId).single();
  if (item.error) throw item.error;
  if (item.data.post_id) return;

  const asset = await supabase.from("media_assets")
    .select("public_url").eq("id", item.data.final_asset_id).single();
  if (asset.error) throw asset.error;

  const batch = await supabase.from("generation_batches")
    .select("audio_asset_id").eq("id", item.data.batch_id).single();
  if (batch.error) throw batch.error;
  const audio = await supabase.from("media_assets")
    .select("public_url").eq("id", batch.data.audio_asset_id).single();
  if (audio.error) throw audio.error;

  const plan = (item.data.input_payload?.prompt_plan ?? {}) as Record<string, unknown>;

  const post = await supabase.from("posts").insert({
    account_id: item.data.account_id,
    platform: "tiktok",
    post_type: "video",
    video_url: asset.data.public_url,
    video_source: "stock",
    audio_url: audio.data.public_url,
    caption: String(plan.caption ?? "sound on"),
    hashtags: Array.isArray(plan.hashtags) ? plan.hashtags : ["#fyp", "#music", "#edit"],
    hook_text: String(plan.hookText ?? "sound on"),
    scheduled_at: item.data.scheduled_at,
    status: "pending",
    publish_status: "ready",
    batch_id: item.data.batch_id,
    generation_item_id: itemId,
    final_asset_id: item.data.final_asset_id,
    tiktok_disable_duet: true,
    tiktok_disable_stitch: true,
    tiktok_disable_comment: false,
    tiktok_is_aigc: true,
  }).select("id").single();
  if (post.error) throw post.error;

  await supabase.from("generation_items")
    .update({ status: "complete", post_id: post.data.id })
    .eq("id", itemId);
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (!isAuthorizedCronCall(request)) return errorResponse("Unauthorized cron call", 401);

  const runId = await startWorkerRun(FUNCTION_NAME);
  let processed = 0;
  let errors = 0;
  const errorList: Array<{ itemId: string; error: string }> = [];

  try {
    const supabase = getSupabaseAdmin();
    const due = await supabase.from("generation_items")
      .select("id, generation_batches!inner(paused_at)")
      .in("status", ["pending", "planning", "generating", "picking_stock", "stitched", "transcribing"])
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
        await supabase.from("generation_items")
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
