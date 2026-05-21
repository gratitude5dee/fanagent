// Cron worker for all FanAgent video generation modes.
// Claims due rows atomically with claim_generation_items(), then routes each
// item through stock/fal segment rendering or the optional GMI async adapter.

import {
  createMediaAssetFromBytes,
  downloadBytes,
  renderedVideoSignedUrlSeconds,
  renderedVideoStoragePath,
} from "../_shared/assets.ts";
import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { errorMessage, serializeError } from "../_shared/errors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { findGmiVideoUrl, normalizeSourceMode } from "../_shared/generation.ts";
import { buildLibraryFailureUpdate, deriveBatchLibraryStatus } from "../_shared/library.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { endWorkerRun, isAuthorizedCronCall, startWorkerRun } from "../_shared/workers.ts";

const FUNCTION_NAME = "fanpage-generate-due";
const GMI_BASE =
  optionalEnv("GMI_API_BASE") ?? "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey";

type Segment = { source: "stock" | "seedance"; url?: string; prompt?: string };

type GenerationItem = {
  id: string;
  batch_id: string;
  account_id: string;
  audio_clip_id: string | null;
  item_index: number;
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
  library_item_id: string | null;
  stock_clip_url: string | null;
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

function childTimeoutMs(): number {
  const configured = Number(optionalEnv("FANAGENT_CHILD_TIMEOUT_MS") ?? 105_000);
  if (!Number.isFinite(configured)) return 105_000;
  return Math.max(15_000, Math.min(Math.floor(configured), 120_000));
}

async function invokeChild(
  name: string,
  body: unknown,
  timeoutMs = childTimeoutMs(),
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(fnUrl(name), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": optionalEnv("CRON_SECRET") ?? "",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${name} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function ok(res: Response, label: string) {
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${label} failed [${res.status}]: ${err.slice(0, 500)}`);
  }
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(408|409|429|500|502|503|504|520|522|524|timeout|timed\s+out|connection_timeout|cloudflare_error|rate_limit|temporar|network|connection reset)\b/i.test(
    message,
  );
}

function isIdleTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(IDLE_TIMEOUT|idle timeout|timeout limit|timed\s+out|504)\b/i.test(message);
}

function maxPerRun(): number {
  const configured = Number(optionalEnv("FANAGENT_GENERATE_MAX_PER_RUN") ?? 1);
  if (!Number.isFinite(configured)) return 1;
  return Math.max(1, Math.min(Math.floor(configured), 3));
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

async function releaseItemForNextStage(itemId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const updated = await supabase
    .from("generation_items")
    .update({
      attempt_count: 0,
      error_message: null,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (updated.error) throw updated.error;
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

async function finalizeLibraryItem(itemId: string) {
  await ok(await invokeChild("library-finalize", { generationItemId: itemId }), "library-finalize");
  await addStageEvent(itemId, "library_finalized");
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

async function processGmiItem(item: GenerationItem, audioAsset: MediaAsset) {
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
    fileName: `${item.library_item_id ?? item.id}.mp4`,
    storageBucket: "renders",
    storagePath: renderedVideoStoragePath(item.account_id, item.library_item_id ?? item.id),
    publicUrlMode: "signed",
    signedUrlExpiresIn: renderedVideoSignedUrlSeconds,
    upsert: true,
    metadata: {
      original_url: videoUrl,
      generation_item_id: item.id,
      library_item_id: item.library_item_id,
      provider_request_id: requestId,
      signed_url_expires_in_seconds: renderedVideoSignedUrlSeconds,
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
  await finalizeLibraryItem(item.id);
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
    await processGmiItem(item, audioAsset);
    return;
  }

  if (item.status === "ready" && item.final_asset_id) {
    await finalizeLibraryItem(item.id);
    return;
  }

  if (item.status === "stitched" && item.stock_clip_url) {
    await addStageEvent(item.id, "render_start");
    await ok(await invokeChild("render-karaoke", { itemId }), "render-karaoke");
    return;
  }

  if (!audioAsset.transcript) {
    await transcribeBestEffort(audioAsset.id, item.id);
  }

  const segments = (item.segments ?? []) as Segment[];
  if (segments.length === 0) {
    await addStageEvent(item.id, "planning_segments");
    await ok(await invokeChild("pick-stock-clip", { itemId }), "pick-stock-clip");
    await releaseItemForNextStage(item.id);
    return;
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
      await releaseItemForNextStage(item.id);
      return;
    }
  }

  await addStageEvent(item.id, "stitch_start");
  await ok(await invokeChild("stitch-segments", { itemId }), "stitch-segments");
  await releaseItemForNextStage(item.id);
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
    update.completed_at = null;
    update.error_message = null;
  }

  const updated = await supabase.from("generation_batches").update(update).eq("id", batchId);
  if (updated.error) throw updated.error;
}

async function refreshBatchLibraryStatus(batchId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const rows = await supabase.from("video_library_items").select("status").eq("batch_id", batchId);
  if (rows.error) throw rows.error;
  const batch = await supabase
    .from("generation_batches")
    .select("quantity,post_count")
    .eq("id", batchId)
    .maybeSingle();
  if (batch.error) throw batch.error;

  const requestedQuantity = Number(batch.data?.quantity ?? batch.data?.post_count ?? 0);
  const libraryStatus = deriveBatchLibraryStatus(
    (rows.data ?? []).map((row) => row.status),
    requestedQuantity,
  );
  if (libraryStatus === "building" && (rows.data ?? []).length === 0) return;

  const updated = await supabase
    .from("generation_batches")
    .update({ library_status: libraryStatus, updated_at: new Date().toISOString() })
    .eq("id", batchId);
  if (updated.error) throw updated.error;
}

async function failLinkedLibraryItem(item: GenerationItem, error: unknown): Promise<void> {
  const supabase = getSupabaseAdmin();
  let libraryItemId = item.library_item_id;
  if (!libraryItemId) {
    const linked = await supabase
      .from("video_library_items")
      .select("id")
      .eq("generation_item_id", item.id)
      .maybeSingle();
    if (linked.error) throw linked.error;
    libraryItemId = linked.data?.id ?? null;
  }
  if (!libraryItemId && item.batch_id && item.audio_clip_id) {
    const matched = await supabase
      .from("video_library_items")
      .select("id")
      .eq("batch_id", item.batch_id)
      .eq("audio_clip_id", item.audio_clip_id)
      .eq("library_index", item.item_index)
      .maybeSingle();
    if (matched.error) throw matched.error;
    libraryItemId = matched.data?.id ?? null;
  }
  if (!libraryItemId) return;

  if (!item.library_item_id) {
    const linkedItem = await supabase
      .from("generation_items")
      .update({ library_item_id: libraryItemId, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .is("library_item_id", null);
    if (linkedItem.error) throw linkedItem.error;
  }

  const current = await supabase
    .from("video_library_items")
    .select("metadata,status")
    .eq("id", libraryItemId)
    .maybeSingle();
  if (current.error) throw current.error;
  if (["ready", "scheduled", "posted"].includes(String(current.data?.status ?? ""))) return;

  const failed = await supabase
    .from("video_library_items")
    .update(
      buildLibraryFailureUpdate({
        metadata: current.data?.metadata,
        error,
        generationItemId: item.id,
      }),
    )
    .eq("id", libraryItemId);
  if (failed.error) throw failed.error;
}

async function claimDueItems(limit: number) {
  const supabase = getSupabaseAdmin();
  const claimed = await supabase.rpc("claim_generation_items", {
    p_limit: limit,
    p_worker_id: `${FUNCTION_NAME}-${crypto.randomUUID()}`,
    p_claim_window_minutes: 3,
  });
  if (claimed.error) throw claimed.error;
  return (claimed.data ?? []) as GenerationItem[];
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (!(await isAuthorizedCronCall(request))) {
    return errorEnvelope("Unauthorized cron call", "UNAUTHORIZED_CRON", 401);
  }

  const runId = await startWorkerRun(FUNCTION_NAME);
  let processed = 0;
  let errors = 0;
  const errorList: Array<{ itemId: string; error: string; retry: boolean }> = [];

  try {
    const supabase = getSupabaseAdmin();
    const maxItems = maxPerRun();
    const due = await claimDueItems(maxItems);

    for (const row of due) {
      try {
        await processItem(row.id);
        const clearError = await supabase
          .from("generation_items")
          .update({ error_message: null, locked_at: null, locked_by: null })
          .eq("id", row.id);
        if (clearError.error) throw clearError.error;
        await refreshBatchStatus(row.batch_id);
        await refreshBatchLibraryStatus(row.batch_id);
        processed += 1;
      } catch (err) {
        errors += 1;
        const serialized = serializeError(err);
        const msg = errorMessage(err);
        const idleTimeout = isIdleTimeout(err);
        const maxAttempts = idleTimeout
          ? Math.max(row.max_attempts ?? 3, 5)
          : (row.max_attempts ?? 3);
        const retry = isRetryable(err) && (row.attempt_count ?? 0) < maxAttempts;
        errorList.push({ itemId: row.id, error: msg, retry });
        await supabase
          .from("generation_items")
          .update({
            status: retry ? "pending" : "failed",
            max_attempts: maxAttempts,
            locked_at: null,
            locked_by: null,
            error_message: msg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        await addStageEvent(row.id, retry ? "retry_scheduled" : "failed", {
          error: msg,
          errorDetail: serialized,
          ...(idleTimeout ? { maxAttempts } : {}),
        });
        if (!retry) {
          await failLinkedLibraryItem(row, err);
          await refreshBatchLibraryStatus(row.batch_id);
        }
        await refreshBatchStatus(row.batch_id);
      }
    }

    await endWorkerRun(runId, processed, errors, { errors: errorList, maxPerRun: maxItems });
    return okEnvelope({ processed, errors, errorList, maxPerRun: maxItems });
  } catch (error) {
    await endWorkerRun(runId, processed, errors + 1, {
      fatal: errorMessage(error),
      fatalDetail: serializeError(error),
    });
    return errorEnvelope(error, "GENERATION_WORKER_FAILED", 500);
  }
});
