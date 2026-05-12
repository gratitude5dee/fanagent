// Cron worker for all FanAgent video generation modes.
// Claims due rows atomically with claim_generation_items(), then routes each
// item through stock/fal segment rendering or the optional GMI async adapter.

import { createMediaAssetFromBytes, downloadBytes } from "../_shared/assets.ts";
import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { findGmiVideoUrl, normalizeSourceMode } from "../_shared/generation.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { endWorkerRun, isAuthorizedCronCall, startWorkerRun } from "../_shared/workers.ts";

const MAX_PER_RUN = 5;
const FUNCTION_NAME = "fanpage-generate-due";
const GMI_BASE =
  optionalEnv("GMI_API_BASE") ?? "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey";

type Segment = { source: "stock" | "seedance"; url?: string; prompt?: string };

type GenerationItem = {
  id: string;
  batch_id: string;
  account_id: string;
  segments: Segment[] | null;
  status: string;
  provider: string;
  model_id: string | null;
  prompt: string;
  input_payload: Record<string, unknown> | null;
  provider_request_id: string | null;
  scheduled_at: string;
  duration_seconds: number;
  final_asset_id: string | null;
  post_id: string | null;
  attempt_count: number;
  max_attempts: number;
};

type Batch = {
  id: string;
  audio_asset_id: string;
  source_mode: string;
  publish_defaults?: Record<string, unknown> | null;
};

type MediaAsset = {
  id: string;
  public_url: string;
  mime_type: string | null;
  file_name: string | null;
  transcript?: unknown;
};

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

async function ok(res: Response, label: string) {
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${label} failed [${res.status}]: ${err.slice(0, 500)}`);
  }
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(408|409|429|500|502|503|504|timeout|rate_limit|temporar|network)\b/i.test(message);
}

function gmiKey(): string {
  const key = optionalEnv("GMI_API_KEY") ?? optionalEnv("GMI_CLOUD_API_KEY");
  if (!key) throw new Error("GMI_API_KEY or GMI_CLOUD_API_KEY must be set");
  return key;
}

function gmiHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${gmiKey()}`,
    "Content-Type": "application/json",
  };
  const orgId = optionalEnv("GMI_ORG_ID");
  if (orgId) headers["X-Organization-ID"] = orgId;
  return headers;
}

async function readJson<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${response.statusText} ${text}`.trim());
  }
  return json as T;
}

async function addStageEvent(
  itemId: string,
  stage: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const current = await supabase
    .from("generation_items")
    .select("stage_events")
    .eq("id", itemId)
    .maybeSingle();
  const events = Array.isArray(current.data?.stage_events) ? current.data.stage_events : [];
  await supabase
    .from("generation_items")
    .update({
      stage_events: [...events.slice(-40), { stage, at: new Date().toISOString(), ...detail }],
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
}

async function transcribeBestEffort(audioAssetId: string, itemId: string) {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("generation_items")
    .update({ status: "transcribing", updated_at: new Date().toISOString() })
    .eq("id", itemId);
  try {
    await ok(await invokeChild("transcribe-audio", { audioAssetId }), "transcribe-audio");
    await addStageEvent(itemId, "transcribed");
  } catch (err) {
    await addStageEvent(itemId, "transcription_skipped", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

async function enqueueGmi(item: GenerationItem, audioAsset: MediaAsset) {
  const model = item.model_id ?? optionalEnv("GMI_SEEDANCE_MODEL_ID") ?? "Seedance-2.0";
  return readJson<{ request_id: string; status?: string }>(
    await fetch(`${GMI_BASE}/requests`, {
      method: "POST",
      headers: gmiHeaders(),
      body: JSON.stringify({
        model,
        payload: {
          prompt: item.prompt,
          durationSeconds: String(item.duration_seconds || 15),
          aspectRatio: "9:16",
          negativePrompt: "logos, watermarks, unreadable text, distorted hands, low quality",
          audioUrl: audioAsset.public_url,
          musicReferenceUrl: audioAsset.public_url,
        },
      }),
    }),
    "GMI enqueue",
  );
}

async function pollGmi(requestId: string) {
  return readJson<{ request_id: string; status: string; outcome?: unknown; error?: unknown }>(
    await fetch(`${GMI_BASE}/requests/${requestId}`, {
      method: "GET",
      headers: gmiHeaders(),
    }),
    "GMI poll",
  );
}

async function processGmiItem(item: GenerationItem, batch: Batch, audioAsset: MediaAsset) {
  const supabase = getSupabaseAdmin();
  let requestId = item.provider_request_id;
  if (!requestId) {
    const queued = await enqueueGmi(item, audioAsset);
    requestId = queued.request_id;
    const updated = await supabase
      .from("generation_items")
      .update({
        status: "generating",
        provider_request_id: requestId,
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (updated.error) throw updated.error;
    await addStageEvent(item.id, "gmi_queued", { requestId });
    return { status: "waiting", requestId };
  }

  const status = await pollGmi(requestId);
  const normalized = status.status.toLowerCase();
  if (!["success", "finished", "complete", "completed"].includes(normalized)) {
    if (["failed", "error", "cancelled", "canceled"].includes(normalized)) {
      throw new Error(
        `GMI request ${requestId} failed: ${JSON.stringify(
          status.error ?? status.outcome ?? status,
        )}`,
      );
    }
    await supabase
      .from("generation_items")
      .update({
        status: "generating",
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    await addStageEvent(item.id, "gmi_poll", { requestId, status: status.status });
    return { status: status.status, requestId };
  }

  const videoUrl = findGmiVideoUrl(status.outcome);
  if (!videoUrl) {
    throw new Error(`GMI request ${requestId} completed without a video artifact.`);
  }
  const downloaded = await downloadBytes(videoUrl);
  const asset = await createMediaAssetFromBytes({
    accountId: item.account_id,
    kind: "rendered_video",
    source: "gmi_seedance",
    bytes: downloaded.bytes,
    mimeType:
      downloaded.mimeType === "application/octet-stream" ? "video/mp4" : downloaded.mimeType,
    fileName: `${item.id}.mp4`,
    metadata: {
      original_url: videoUrl,
      generation_item_id: item.id,
      provider_request_id: requestId,
    },
  });
  const updated = await supabase
    .from("generation_items")
    .update({
      status: "ready",
      final_asset_id: asset.id,
      render_provider: "gmi_seedance",
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  if (updated.error) throw updated.error;
  await addStageEvent(item.id, "gmi_complete", { requestId, finalAssetId: asset.id });
  await createPostForItem(item.id, batch);
  return { status: "complete", requestId };
}

async function processItem(itemId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const itemResult = await supabase.from("generation_items").select("*").eq("id", itemId).single();
  if (itemResult.error) throw itemResult.error;
  const item = itemResult.data as GenerationItem;

  const batchResult = await supabase
    .from("generation_batches")
    .select("id,audio_asset_id,source_mode,publish_defaults")
    .eq("id", item.batch_id)
    .single();
  if (batchResult.error) throw batchResult.error;
  const batch = batchResult.data as Batch;

  const audioResult = await supabase
    .from("media_assets")
    .select("id,public_url,mime_type,file_name,transcript")
    .eq("id", batch.audio_asset_id)
    .single();
  if (audioResult.error) throw audioResult.error;
  const audioAsset = audioResult.data as MediaAsset;

  const sourceMode = normalizeSourceMode(batch.source_mode ?? item.provider);
  if (sourceMode === "gmi_seedance") {
    await processGmiItem(item, batch, audioAsset);
    return;
  }

  if (item.status === "ready" && item.final_asset_id) {
    await createPostForItem(item.id, batch);
    return;
  }

  if (!audioAsset.transcript) {
    await transcribeBestEffort(audioAsset.id, item.id);
  }

  let segments = (item.segments ?? []) as Segment[];
  if (segments.length === 0) {
    await addStageEvent(item.id, "planning_segments");
    await ok(await invokeChild("pick-stock-clip", { itemId }), "pick-stock-clip");
    const reload = await supabase
      .from("generation_items")
      .select("segments")
      .eq("id", itemId)
      .single();
    if (reload.error) throw reload.error;
    segments = (reload.data?.segments ?? []) as Segment[];
  }

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment.source === "seedance" && !segment.url) {
      await addStageEvent(item.id, "seedance_segment_start", { segmentIndex: i });
      await ok(
        await invokeChild("generate-seedance-clip", { itemId, segmentIndex: i }),
        `generate-seedance-clip[${i}]`,
      );
      await addStageEvent(item.id, "seedance_segment_complete", { segmentIndex: i });
    }
  }

  await addStageEvent(item.id, "stitch_start");
  await ok(await invokeChild("stitch-segments", { itemId }), "stitch-segments");

  await addStageEvent(item.id, "render_start");
  await ok(await invokeChild("render-karaoke", { itemId }), "render-karaoke");

  await createPostForItem(item.id, batch);
}

async function refreshBatchStatus(batchId: string) {
  const supabase = getSupabaseAdmin();
  const items = await supabase.from("generation_items").select("status").eq("batch_id", batchId);
  if (items.error) throw items.error;

  const statuses = (items.data ?? []).map((item) => item.status);
  const everyComplete = statuses.length > 0 && statuses.every((status) => status === "complete");
  const everyTerminal =
    statuses.length > 0 &&
    statuses.every((status) => ["complete", "failed", "skipped"].includes(status));
  const everyFailed =
    statuses.length > 0 && statuses.every((status) => status === "failed" || status === "skipped");
  const status = everyComplete
    ? "complete"
    : everyFailed
      ? "failed"
      : everyTerminal
        ? "partial"
        : "generating";

  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (["complete", "failed", "partial"].includes(status)) {
    update.completed_at = new Date().toISOString();
  } else {
    update.started_at = new Date().toISOString();
  }

  const updated = await supabase.from("generation_batches").update(update).eq("id", batchId);
  if (updated.error) throw updated.error;
}

async function createPostForItem(itemId: string, batchData?: Batch) {
  const supabase = getSupabaseAdmin();
  const item = await supabase
    .from("generation_items")
    .select(
      "id,account_id,batch_id,scheduled_at,final_asset_id,input_payload,post_id,provider,render_provider",
    )
    .eq("id", itemId)
    .single();
  if (item.error) throw item.error;
  if (item.data.post_id) return;

  const asset = await supabase
    .from("media_assets")
    .select("public_url")
    .eq("id", item.data.final_asset_id)
    .single();
  if (asset.error) throw asset.error;

  const batch = batchData
    ? { data: batchData, error: null }
    : await supabase
        .from("generation_batches")
        .select("id,audio_asset_id,source_mode,publish_defaults")
        .eq("id", item.data.batch_id)
        .single();
  if (batch.error) throw batch.error;

  const audio = await supabase
    .from("media_assets")
    .select("public_url")
    .eq("id", batch.data.audio_asset_id)
    .single();
  if (audio.error) throw audio.error;

  const inputPayload = (item.data.input_payload ?? {}) as Record<string, unknown>;
  const plan = (inputPayload.prompt_plan ?? {}) as Record<string, unknown>;
  const publishDefaults: Record<string, unknown> = {
    privacyLevel: "SELF_ONLY",
    disableDuet: true,
    disableStitch: true,
    disableComment: false,
    ...((inputPayload.publish_defaults ?? {}) as Record<string, unknown>),
    ...((batch.data.publish_defaults ?? {}) as Record<string, unknown>),
  };

  const post = await supabase
    .from("posts")
    .insert({
      account_id: item.data.account_id,
      platform: "tiktok",
      post_type: "video",
      video_url: asset.data.public_url,
      video_source: item.data.render_provider ?? item.data.provider ?? "stock",
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
      tiktok_privacy_level: String(publishDefaults.privacyLevel ?? "SELF_ONLY"),
      tiktok_disable_duet: publishDefaults.disableDuet !== false,
      tiktok_disable_stitch: publishDefaults.disableStitch !== false,
      tiktok_disable_comment: publishDefaults.disableComment === true,
      tiktok_is_aigc: true,
      tiktok_brand_content: publishDefaults.brandContentToggle === true,
      tiktok_brand_organic: publishDefaults.brandOrganicToggle === true,
    })
    .select("id")
    .single();
  if (post.error) throw post.error;

  await supabase
    .from("generation_items")
    .update({
      status: "complete",
      post_id: post.data.id,
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  await addStageEvent(itemId, "post_created", { postId: post.data.id });
  await refreshBatchStatus(item.data.batch_id);
}

async function claimDueItems(limit: number) {
  const supabase = getSupabaseAdmin();
  const claimed = await supabase.rpc("claim_generation_items", {
    p_limit: limit,
    p_worker_id: `${FUNCTION_NAME}-${crypto.randomUUID()}`,
    p_claim_window_minutes: 15,
  });
  if (claimed.error) throw claimed.error;
  return (claimed.data ?? []) as GenerationItem[];
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (!(await isAuthorizedCronCall(request))) return errorResponse("Unauthorized cron call", 401);

  const runId = await startWorkerRun(FUNCTION_NAME);
  let processed = 0;
  let errors = 0;
  const errorList: Array<{ itemId: string; error: string; retry: boolean }> = [];

  try {
    const supabase = getSupabaseAdmin();
    const due = await claimDueItems(MAX_PER_RUN);

    for (const row of due) {
      try {
        await processItem(row.id);
        processed += 1;
      } catch (err) {
        errors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        const retry = isRetryable(err) && (row.attempt_count ?? 0) < (row.max_attempts ?? 3);
        errorList.push({ itemId: row.id, error: msg, retry });
        await supabase
          .from("generation_items")
          .update({
            status: retry ? "pending" : "failed",
            locked_at: null,
            error_message: msg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        await addStageEvent(row.id, retry ? "retry_scheduled" : "failed", { error: msg });
        if (!retry) await refreshBatchStatus(row.batch_id);
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
