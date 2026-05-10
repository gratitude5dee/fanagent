import { createMediaAssetFromBytes, downloadBytes } from "../_shared/assets.ts";
import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { findGmiVideoUrl } from "../_shared/generation.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type GenerationItem = {
  id: string;
  batch_id: string;
  account_id: string;
  item_index: number;
  status: "pending" | "generating" | "rendering" | "complete" | "failed";
  provider: "gmi_seedance" | "remote_render";
  model_id: string | null;
  prompt: string;
  input_payload: Record<string, unknown>;
  provider_request_id: string | null;
  scheduled_at: string;
  duration_seconds: number;
};

type Batch = {
  id: string;
  account_id: string;
  audio_asset_id: string;
  source_mode: string;
  status: string;
};

type MediaAsset = {
  id: string;
  public_url: string;
  mime_type: string | null;
  file_name: string | null;
};

const gmiBase = optionalEnv("GMI_API_BASE") ??
  "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey";

function gmiHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${requireEnv("GMI_API_KEY")}`,
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
    throw new Error(
      `${label} failed: ${response.status} ${response.statusText} ${text}`
        .trim(),
    );
  }
  return json as T;
}

async function enqueueGmi(item: GenerationItem, audioAsset: MediaAsset) {
  const model = item.model_id ?? optionalEnv("GMI_SEEDANCE_MODEL_ID") ??
    "Seedance-2.0";
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
          negativePrompt:
            "logos, watermarks, unreadable text, distorted hands, low quality",
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
  return readJson<
    { request_id: string; status: string; outcome?: unknown; error?: unknown }
  >(
    await fetch(`${gmiBase}/requests/${requestId}`, {
      method: "GET",
      headers: gmiHeaders(),
    }),
    "GMI poll",
  );
}

async function createRemoteRender(
  item: GenerationItem,
  audioAsset: MediaAsset,
) {
  const endpoint = requireEnv("REMOTE_RENDER_API_URL");
  return readJson<
    {
      request_id?: string;
      status?: string;
      video_url?: string;
      videoUrl?: string;
      url?: string;
    }
  >(
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

function promptPlan(item: GenerationItem) {
  const payloadPlan = item.input_payload?.prompt_plan;
  return payloadPlan && typeof payloadPlan === "object"
    ? payloadPlan as Record<string, unknown>
    : {};
}

async function refreshBatchStatus(batchId: string) {
  const supabase = getSupabaseAdmin();
  const items = await supabase.from("generation_items").select("status").eq(
    "batch_id",
    batchId,
  );
  if (items.error) throw items.error;
  const statuses = (items.data ?? []).map((item) => item.status);
  const everyComplete = statuses.length > 0 &&
    statuses.every((status) => status === "complete");
  const everyTerminal = statuses.length > 0 &&
    statuses.every((status) => status === "complete" || status === "failed");
  const everyFailed = statuses.length > 0 &&
    statuses.every((status) => status === "failed");
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
  }

  const result = await supabase.from("generation_batches").update(update).eq(
    "id",
    batchId,
  );
  if (result.error) throw result.error;
}

async function createPostFromVideo(
  item: GenerationItem,
  batch: Batch,
  audioAsset: MediaAsset,
  videoUrl: string,
  source: string,
) {
  const supabase = getSupabaseAdmin();
  const downloaded = await downloadBytes(videoUrl);
  const mimeType = downloaded.mimeType === "application/octet-stream"
    ? "video/mp4"
    : downloaded.mimeType;
  const asset = await createMediaAssetFromBytes({
    accountId: item.account_id,
    kind: "rendered_video",
    source,
    bytes: downloaded.bytes,
    mimeType,
    fileName: `${item.id}.mp4`,
    metadata: {
      original_url: videoUrl,
      generation_item_id: item.id,
      provider_request_id: item.provider_request_id,
    },
  });
  const plan = promptPlan(item);
  const post = await supabase
    .from("posts")
    .insert({
      account_id: item.account_id,
      platform: "tiktok",
      post_type: "video",
      video_url: asset.public_url,
      video_source: source,
      audio_url: audioAsset.public_url,
      caption: String(plan.caption ?? "sound on"),
      hashtags: Array.isArray(plan.hashtags)
        ? plan.hashtags
        : ["#fyp", "#music", "#edit"],
      hook_text: String(plan.hookText ?? "sound on"),
      scheduled_at: item.scheduled_at,
      status: "pending",
      publish_status: "ready",
      batch_id: batch.id,
      generation_item_id: item.id,
      final_asset_id: asset.id,
      tiktok_privacy_level: null,
      tiktok_disable_duet: true,
      tiktok_disable_stitch: true,
      tiktok_disable_comment: false,
      tiktok_is_aigc: true,
    })
    .select("*")
    .single();

  if (post.error) throw post.error;

  const itemUpdate = await supabase
    .from("generation_items")
    .update({
      status: "complete",
      final_asset_id: asset.id,
      post_id: post.data.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  if (itemUpdate.error) throw itemUpdate.error;

  return post.data;
}

async function processItem(item: GenerationItem) {
  const supabase = getSupabaseAdmin();
  const batchResult = await supabase.from("generation_batches").select("*").eq(
    "id",
    item.batch_id,
  ).single();
  if (batchResult.error) throw batchResult.error;
  const batch = batchResult.data as Batch;

  const audioResult = await supabase.from("media_assets").select("*").eq(
    "id",
    batch.audio_asset_id,
  ).single();
  if (audioResult.error) throw audioResult.error;
  const audioAsset = audioResult.data as MediaAsset;

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
    const post = await createPostFromVideo(
      item,
      batch,
      audioAsset,
      videoUrl,
      "remote_render",
    );
    await refreshBatchStatus(batch.id);
    return { id: item.id, status: "complete", postId: post.id };
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
      throw new Error(
        `GMI request ${requestId} completed without a video artifact.`,
      );
    }
    const post = await createPostFromVideo(
      { ...item, provider_request_id: requestId },
      batch,
      audioAsset,
      videoUrl,
      "gmi_seedance",
    );
    await refreshBatchStatus(batch.id);
    return { id: item.id, status: "complete", postId: post.id };
  }

  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) {
    throw new Error(
      `GMI request ${requestId} failed: ${
        JSON.stringify(status.error ?? status.outcome ?? status)
      }`,
    );
  }

  return { id: item.id, status: status.status, requestId };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405);
  }

  const supabase = getSupabaseAdmin();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 3);
  const results: unknown[] = [];

  try {
    const query = await supabase
      .from("generation_items")
      .select("*")
      .in("status", ["pending", "generating"])
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

    return jsonResponse({ processed: results.length, results });
  } catch (error) {
    return errorResponse(error);
  }
});
