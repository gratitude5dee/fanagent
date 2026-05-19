// Deprecated legacy worker retained for back-compat with old cron wiring.
// New generation work should flow through fanpage-generate-due. This worker
// only finalizes legacy GMI/remote-render items into video_library_items; it
// must not create scheduled posts directly.

import {
  createMediaAssetFromBytes,
  downloadBytes,
  renderedVideoSignedUrlSeconds,
  renderedVideoStoragePath,
} from "../_shared/assets.ts";
import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { findGmiVideoUrl } from "../_shared/generation.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { isAuthorizedCronCall } from "../_shared/workers.ts";

type GenerationItem = {
  id: string;
  batch_id: string;
  account_id: string;
  item_index: number;
  status: "pending" | "generating" | "rendering" | "ready" | "complete" | "failed";
  provider: "gmi_seedance" | "remote_render";
  model_id: string | null;
  prompt: string;
  input_payload: Record<string, unknown>;
  provider_request_id: string | null;
  final_asset_id: string | null;
  scheduled_at: string;
  duration_seconds: number;
  audio_clip_id: string | null;
  library_item_id: string | null;
};

type Batch = {
  id: string;
  account_id: string;
  audio_asset_id: string;
  audio_clip_id: string | null;
  source_mode: string;
  status: string;
};

type MediaAsset = {
  id: string;
  public_url: string;
  mime_type: string | null;
  file_name: string | null;
};

const gmiBase =
  optionalEnv("GMI_API_BASE") ?? "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey";

function fnUrl(name: string): string {
  return `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
}

async function invokeChild(name: string, body: unknown): Promise<Response> {
  return fetch(fnUrl(name), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": optionalEnv("CRON_SECRET") ?? "",
    },
    body: JSON.stringify(body),
  });
}

function gmiKey(): string {
  return (
    optionalEnv("GMI_API_KEY") ??
    optionalEnv("GMI_CLOUD_API_KEY") ??
    (() => {
      throw new Error("GMI_API_KEY or GMI_CLOUD_API_KEY must be set");
    })()
  );
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

async function enqueueGmi(item: GenerationItem, audioAsset: MediaAsset) {
  const model = item.model_id ?? optionalEnv("GMI_SEEDANCE_MODEL_ID") ?? "Seedance-2.0";
  return readJson<{ request_id: string; status?: string }>(
    await fetch(`${gmiBase}/requests`, {
      method: "POST",
      headers: gmiHeaders(),
      body: JSON.stringify({
        model,
        payload: {
          prompt: item.prompt,
          durationSeconds: String(item.duration_seconds || 15),
          aspectRatio: "9:16",
          negativePrompt: "logos, watermarks, unreadable text, distorted hands, low quality",
          seed: null,
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
    await fetch(`${gmiBase}/requests/${requestId}`, {
      method: "GET",
      headers: gmiHeaders(),
    }),
    "GMI poll",
  );
}

async function createRemoteRender(item: GenerationItem, audioAsset: MediaAsset) {
  const endpoint = requireEnv("REMOTE_RENDER_API_URL");
  return readJson<{
    request_id?: string;
    status?: string;
    video_url?: string;
    videoUrl?: string;
    url?: string;
  }>(
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(optionalEnv("REMOTE_RENDER_API_KEY")
          ? { Authorization: `Bearer ${optionalEnv("REMOTE_RENDER_API_KEY")}` }
          : {}),
      },
      body: JSON.stringify({
        itemId: item.id,
        batchId: item.batch_id,
        prompt: item.prompt,
        audioUrl: audioAsset.public_url,
        durationSeconds: item.duration_seconds || 15,
        aspectRatio: "9:16",
      }),
    }),
    "Remote render",
  );
}

async function refreshBatchStatus(batchId: string) {
  const supabase = getSupabaseAdmin();
  const items = await supabase.from("generation_items").select("status").eq("batch_id", batchId);
  if (items.error) throw items.error;
  const statuses = (items.data ?? []).map((item) => item.status);
  const everyComplete = statuses.length > 0 && statuses.every((status) => status === "complete");
  const everyTerminal =
    statuses.length > 0 && statuses.every((status) => status === "complete" || status === "failed");
  const everyFailed = statuses.length > 0 && statuses.every((status) => status === "failed");
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
  if (status === "complete" || status === "failed" || status === "partial") {
    update.completed_at = new Date().toISOString();
  } else {
    update.started_at = new Date().toISOString();
    update.completed_at = null;
    update.error_message = null;
  }

  const result = await supabase.from("generation_batches").update(update).eq("id", batchId);
  if (result.error) throw result.error;
}

async function finalizeLibraryItemFromVideo(
  item: GenerationItem,
  batch: Batch,
  videoUrl: string,
  source: string,
) {
  const supabase = getSupabaseAdmin();
  const libraryItemId = await resolveLibraryItemId(item, batch);
  const downloaded = await downloadBytes(videoUrl);
  const mimeType =
    downloaded.mimeType === "application/octet-stream" ? "video/mp4" : downloaded.mimeType;
  const asset = await createMediaAssetFromBytes({
    accountId: item.account_id,
    kind: "rendered_video",
    source,
    bytes: downloaded.bytes,
    mimeType,
    fileName: `${libraryItemId}.mp4`,
    storageBucket: "renders",
    storagePath: renderedVideoStoragePath(item.account_id, libraryItemId),
    publicUrlMode: "signed",
    signedUrlExpiresIn: renderedVideoSignedUrlSeconds,
    upsert: true,
    metadata: {
      original_url: videoUrl,
      generation_item_id: item.id,
      library_item_id: libraryItemId,
      provider_request_id: item.provider_request_id,
      signed_url_expires_in_seconds: renderedVideoSignedUrlSeconds,
    },
  });

  const itemUpdate = await supabase
    .from("generation_items")
    .update({
      status: "ready",
      final_asset_id: asset.id,
      library_item_id: libraryItemId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  if (itemUpdate.error) throw itemUpdate.error;

  const finalized = await finalizeLibraryItem(item.id);
  return { asset, libraryItemId, finalized };
}

async function resolveLibraryItemId(item: GenerationItem, batch: Batch): Promise<string> {
  if (item.library_item_id) return item.library_item_id;

  const audioClipId = item.audio_clip_id ?? batch.audio_clip_id;
  if (!audioClipId) {
    throw new Error("Legacy generation item is missing audio_clip_id.");
  }

  const supabase = getSupabaseAdmin();
  const existing = await supabase
    .from("video_library_items")
    .select("id")
    .eq("generation_item_id", item.id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) return existing.data.id;

  const slot = await supabase
    .from("video_library_items")
    .select("id")
    .eq("batch_id", item.batch_id)
    .eq("audio_clip_id", audioClipId)
    .eq("library_index", item.item_index)
    .maybeSingle();
  if (slot.error) throw slot.error;
  if (slot.data?.id) return slot.data.id;

  const inserted = await supabase
    .from("video_library_items")
    .insert({
      account_id: item.account_id,
      audio_clip_id: audioClipId,
      batch_id: item.batch_id,
      generation_item_id: item.id,
      library_index: item.item_index,
      status: "not_ready",
      duration_sec: item.duration_seconds,
    })
    .select("id")
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id;
}

async function finalizeLibraryItem(generationItemId: string): Promise<unknown> {
  const response = await invokeChild("library-finalize", { generationItemId });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`library-finalize failed [${response.status}]: ${JSON.stringify(json)}`);
  }
  return json;
}

async function processItem(item: GenerationItem) {
  const supabase = getSupabaseAdmin();
  const batchResult = await supabase
    .from("generation_batches")
    .select("*")
    .eq("id", item.batch_id)
    .single();
  if (batchResult.error) throw batchResult.error;
  const batch = batchResult.data as Batch;

  const audioResult = await supabase
    .from("media_assets")
    .select("*")
    .eq("id", batch.audio_asset_id)
    .single();
  if (audioResult.error) throw audioResult.error;
  const audioAsset = audioResult.data as MediaAsset;

  if (item.status === "ready") {
    const finalized = await finalizeLibraryItem(item.id);
    await refreshBatchStatus(batch.id);
    return {
      id: item.id,
      status: "complete",
      libraryItemId: item.library_item_id,
      finalized,
    };
  }

  await supabase
    .from("generation_batches")
    .update({
      status: "generating",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", batch.id)
    .in("status", ["pending", "generating"]);

  if (item.provider === "remote_render") {
    const remote = await createRemoteRender(item, audioAsset);
    const videoUrl = remote.video_url ?? remote.videoUrl ?? remote.url;
    if (!videoUrl) {
      await supabase
        .from("generation_items")
        .update({
          status: "generating",
          provider_request_id: remote.request_id ?? item.provider_request_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      return { id: item.id, status: "waiting", provider: item.provider };
    }
    const finalizedItem = await finalizeLibraryItemFromVideo(
      item,
      batch,
      videoUrl,
      "remote_render",
    );
    await refreshBatchStatus(batch.id);
    return { id: item.id, status: "complete", libraryItemId: finalizedItem.libraryItemId };
  }

  let requestId = item.provider_request_id;
  if (!requestId) {
    const queued = await enqueueGmi(item, audioAsset);
    requestId = queued.request_id;
    const queuedUpdate = await supabase
      .from("generation_items")
      .update({
        status: "generating",
        provider_request_id: requestId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (queuedUpdate.error) throw queuedUpdate.error;
  }

  const status = await pollGmi(requestId);
  const normalized = status.status.toLowerCase();
  if (["success", "finished", "complete", "completed"].includes(normalized)) {
    const videoUrl = findGmiVideoUrl(status.outcome);
    if (!videoUrl) {
      throw new Error(`GMI request ${requestId} completed without a video artifact.`);
    }
    const finalizedItem = await finalizeLibraryItemFromVideo(
      { ...item, provider_request_id: requestId },
      batch,
      videoUrl,
      "gmi_seedance",
    );
    await refreshBatchStatus(batch.id);
    return { id: item.id, status: "complete", libraryItemId: finalizedItem.libraryItemId };
  }

  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) {
    throw new Error(
      `GMI request ${requestId} failed: ${JSON.stringify(
        status.error ?? status.outcome ?? status,
      )}`,
    );
  }

  return { id: item.id, status: status.status, requestId };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") {
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);
  }
  if (!(await isAuthorizedCronCall(request))) {
    return errorEnvelope("Unauthorized cron call", "UNAUTHORIZED_CRON", 401);
  }

  const supabase = getSupabaseAdmin();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 3);
  const results: unknown[] = [];

  try {
    // Only handle the GMI / remote_render providers here. Stock items are
    // owned by `fanpage-generate-due` (fal.ai pipeline).
    const query = await supabase
      .from("generation_items")
      .select("*")
      .in("status", ["pending", "generating", "ready"])
      .in("provider", ["gmi_seedance", "remote_render"])
      .order("created_at", { ascending: true })
      .limit(Math.max(1, Math.min(limit, 10)));
    if (query.error) throw query.error;

    for (const item of (query.data ?? []) as GenerationItem[]) {
      try {
        const result = await processItem(item);
        results.push(result);
        await supabase.from("agent_logs").insert({
          account_id: item.account_id,
          action: "process_generation_item",
          detail: result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await supabase
          .from("generation_items")
          .update({
            status: "failed",
            error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        await refreshBatchStatus(item.batch_id);
        results.push({ id: item.id, status: "failed", error: message });
      }
    }

    return okEnvelope({ processed: results.length, results });
  } catch (error) {
    return errorEnvelope(error, "PROCESS_GENERATION_DUE_FAILED", 500);
  }
});
