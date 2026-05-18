import { downloadBytes } from "../_shared/assets.ts";
import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { errorMessage, serializeError } from "../_shared/errors.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import {
  classifyTikTokPublishError,
  ensureCreatorAllowsPost,
  fetchPublishStatus,
  getAccessToken,
  getTikTokPublishBlock,
  initDirectPost,
  isBlockedPublishStatus,
  queryCreatorInfo,
  type TikTokPublishBlockStatus,
  uploadChunks,
} from "../_shared/tiktok.ts";

type Post = {
  id: string;
  account_id: string;
  video_url: string | null;
  caption: string;
  hashtags: string[] | null;
  scheduled_at: string;
  status: "pending" | "posting" | "posted" | "failed" | "skipped";
  retry_count: number | null;
  tiktok_publish_id: string | null;
  publish_status: string | null;
  tiktok_privacy_level: string | null;
  tiktok_disable_duet: boolean;
  tiktok_disable_stitch: boolean;
  tiktok_disable_comment: boolean;
  tiktok_is_aigc: boolean;
  tiktok_brand_content: boolean;
  tiktok_brand_organic: boolean;
  updated_at?: string | null;
};

type RequestBody = {
  rescanBlockedMinutes?: number;
};

function titleForPost(post: Post): string {
  const hashtags = (post.hashtags ?? []).filter(Boolean).join(" ");
  return `${post.caption || ""} ${hashtags}`.trim().slice(0, 2200);
}

async function applyPublishStatus(post: Post, accessToken: string) {
  const supabase = getSupabaseAdmin();
  if (!post.tiktok_publish_id) {
    return { id: post.id, status: "missing_publish_id" };
  }
  const status = await fetchPublishStatus(accessToken, post.tiktok_publish_id);
  const data = status.data;
  if (!data?.status) {
    throw new Error("TikTok status response missing data.status.");
  }

  if (data.status === "PUBLISH_COMPLETE") {
    const publicIds = (data.publicaly_available_post_id ?? []).map(String);
    const updated = await supabase
      .from("posts")
      .update({
        status: "posted",
        posted_at: new Date().toISOString(),
        publish_status: "publish_complete",
        tiktok_post_id: publicIds[0] ?? null,
        publish_error: null,
        error_message: null,
      })
      .eq("id", post.id);
    if (updated.error) throw updated.error;
    return { id: post.id, status: data.status, publicPostIds: publicIds };
  }

  if (data.status === "FAILED") {
    const updated = await supabase
      .from("posts")
      .update({
        status: "failed",
        publish_status: "failed",
        publish_error: data.fail_reason ?? "TikTok publish failed.",
        error_message: data.fail_reason ?? "TikTok publish failed.",
      })
      .eq("id", post.id);
    if (updated.error) throw updated.error;
    return { id: post.id, status: data.status, reason: data.fail_reason };
  }

  const updated = await supabase
    .from("posts")
    .update({ status: "posting", publish_status: "processing" })
    .eq("id", post.id);
  if (updated.error) throw updated.error;
  return { id: post.id, status: data.status };
}

async function blockPost(
  post: Post,
  publishStatus: TikTokPublishBlockStatus,
  message: string,
  error?: unknown,
) {
  const supabase = getSupabaseAdmin();
  const updated = await supabase
    .from("posts")
    .update({
      status: "pending",
      publish_status: publishStatus,
      publish_error: message,
      error_message: message,
    })
    .eq("id", post.id);
  if (updated.error) throw updated.error;
  return {
    id: post.id,
    status: publishStatus,
    error: message,
    errorDetail: error ? serializeError(error) : null,
  };
}

async function backoffPost(post: Post, error: unknown) {
  const supabase = getSupabaseAdmin();
  const retries = (post.retry_count ?? 0) + 1;
  const delayMinutes = Math.min(240, 5 * 2 ** Math.min(retries, 5));
  const message = error instanceof Error ? error.message : String(error);
  const updated = await supabase
    .from("posts")
    .update({
      status: "pending",
      publish_status: "retry_scheduled",
      publish_error: message,
      error_message: message,
      retry_count: retries,
      scheduled_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    })
    .eq("id", post.id);
  if (updated.error) throw updated.error;
  return {
    id: post.id,
    status: "retry_scheduled",
    delayMinutes,
    error: message,
    errorDetail: serializeError(error),
  };
}

async function failPost(post: Post, error: unknown) {
  const supabase = getSupabaseAdmin();
  const message = errorMessage(error);
  const updated = await supabase
    .from("posts")
    .update({
      status: "failed",
      publish_status: "failed",
      publish_error: message,
      error_message: message,
    })
    .eq("id", post.id);
  if (updated.error) throw updated.error;
  return { id: post.id, status: "failed", error: message, errorDetail: serializeError(error) };
}

async function handlePublishError(post: Post, error: unknown) {
  const classification = classifyTikTokPublishError(error);
  if (classification.kind === "blocked") {
    return blockPost(post, classification.publishStatus, classification.message, error);
  }
  if (classification.kind === "retryable") {
    return backoffPost(post, error);
  }
  return failPost(post, error);
}

async function publishPost(post: Post) {
  const block = getTikTokPublishBlock(post);
  if (block) return blockPost(post, block.publishStatus, block.message);
  const videoUrl = post.video_url as string;
  const privacyLevel = post.tiktok_privacy_level as string;

  const supabase = getSupabaseAdmin();
  const accessToken = await getAccessToken(post.account_id);
  const creatorInfo = await queryCreatorInfo(accessToken);
  ensureCreatorAllowsPost(creatorInfo, post);

  const video = await downloadBytes(videoUrl);
  if (!video.mimeType.includes("mp4") && video.mimeType !== "application/octet-stream") {
    throw new Error(`TikTok Direct Post expects a TikTok-safe MP4; got ${video.mimeType}.`);
  }

  const posting = await supabase
    .from("posts")
    .update({
      status: "posting",
      publish_status: "initializing",
      publish_error: null,
      error_message: null,
    })
    .eq("id", post.id);
  if (posting.error) throw posting.error;

  const init = await initDirectPost(
    accessToken,
    {
      title: titleForPost(post),
      privacyLevel,
      disableDuet: post.tiktok_disable_duet,
      disableComment: post.tiktok_disable_comment,
      disableStitch: post.tiktok_disable_stitch,
      isAigc: post.tiktok_is_aigc,
      brandContentToggle: post.tiktok_brand_content,
      brandOrganicToggle: post.tiktok_brand_organic,
    },
    video.bytes.byteLength,
  );

  const initialized = await supabase
    .from("posts")
    .update({ tiktok_publish_id: init.publish_id, publish_status: "uploading" })
    .eq("id", post.id);
  if (initialized.error) throw initialized.error;

  await uploadChunks(init.upload_url, video.bytes);
  const statusPost = {
    ...post,
    status: "posting",
    tiktok_publish_id: init.publish_id,
  } as Post;
  return applyPublishStatus(statusPost, accessToken);
}

async function processOnePerAccount(posts: Post[]) {
  const seen = new Set<string>();
  const selected: Post[] = [];
  for (const post of posts) {
    if (seen.has(post.account_id)) continue;
    seen.add(post.account_id);
    selected.push(post);
  }
  return selected;
}

function blockedRescanCutoff(minutes: number | undefined): number | null {
  if (!minutes || minutes <= 0) return null;
  return Date.now() - minutes * 60_000;
}

function isEligiblePendingPost(post: Post, cutoff: number | null): boolean {
  if (!isBlockedPublishStatus(post.publish_status)) return true;
  if (cutoff === null) return false;
  const changedAt = Date.parse(post.updated_at ?? post.scheduled_at);
  return Number.isFinite(changedAt) && changedAt <= cutoff;
}

async function readBody(request: Request): Promise<RequestBody> {
  if (!request.body) return {};
  return (await request.json().catch(() => ({}))) as RequestBody;
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405);
  }

  const supabase = getSupabaseAdmin();
  const results: unknown[] = [];
  const body = await readBody(request);
  const rescanCutoff = blockedRescanCutoff(body.rescanBlockedMinutes);

  try {
    const posting = await supabase
      .from("posts")
      .select("*")
      .eq("status", "posting")
      .not("tiktok_publish_id", "is", null)
      .order("scheduled_at", { ascending: true })
      .limit(20);
    if (posting.error) throw posting.error;

    for (const post of await processOnePerAccount((posting.data ?? []) as Post[])) {
      try {
        const accessToken = await getAccessToken(post.account_id);
        results.push(await applyPublishStatus(post, accessToken));
      } catch (error) {
        results.push(await handlePublishError(post, error));
      }
    }

    const due = await supabase
      .from("posts")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(80);
    if (due.error) throw due.error;

    const eligibleDue = ((due.data ?? []) as Post[])
      .filter((post) => isEligiblePendingPost(post, rescanCutoff))
      .slice(0, 20);

    for (const post of await processOnePerAccount(eligibleDue)) {
      try {
        results.push(await publishPost(post));
      } catch (error) {
        results.push(await handlePublishError(post, error));
      }
    }

    await supabase.from("agent_logs").insert({
      action: "publish_tiktok_due",
      detail: { results },
    });

    return jsonResponse({ processed: results.length, results });
  } catch (error) {
    return errorResponse(error);
  }
});
