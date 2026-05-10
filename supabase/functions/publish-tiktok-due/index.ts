import { downloadBytes } from "../_shared/assets.ts";
import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import {
  fetchPublishStatus,
  getAccessToken,
  initDirectPost,
  queryCreatorInfo,
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
        publish_status: data.status,
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
        publish_status: data.status,
        publish_error: data.fail_reason ?? "TikTok publish failed.",
        error_message: data.fail_reason ?? "TikTok publish failed.",
      })
      .eq("id", post.id);
    if (updated.error) throw updated.error;
    return { id: post.id, status: data.status, reason: data.fail_reason };
  }

  const updated = await supabase
    .from("posts")
    .update({ status: "posting", publish_status: data.status })
    .eq("id", post.id);
  if (updated.error) throw updated.error;
  return { id: post.id, status: data.status };
}

function ensureCreatorAllowsPost(
  creatorInfo: Record<string, unknown>,
  post: Post,
) {
  const options = Array.isArray(creatorInfo.privacy_level_options)
    ? creatorInfo.privacy_level_options.map(String)
    : [];
  if (!post.tiktok_privacy_level) {
    throw new Error("Choose a TikTok privacy level before publishing.");
  }
  if (options.length > 0 && !options.includes(post.tiktok_privacy_level)) {
    throw new Error(
      "Selected TikTok privacy level is not available for this creator.",
    );
  }
  if (creatorInfo.duet_disabled === true && !post.tiktok_disable_duet) {
    throw new Error("TikTok creator settings require duet to be disabled.");
  }
  if (creatorInfo.stitch_disabled === true && !post.tiktok_disable_stitch) {
    throw new Error("TikTok creator settings require stitch to be disabled.");
  }
  if (creatorInfo.comment_disabled === true && !post.tiktok_disable_comment) {
    throw new Error("TikTok creator settings require comments to be disabled.");
  }
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|500|502|503|504|rate_limit|internal_error)\b/i.test(message);
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
  };
}

async function failPost(post: Post, error: unknown) {
  const supabase = getSupabaseAdmin();
  const message = error instanceof Error ? error.message : String(error);
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
  return { id: post.id, status: "failed", error: message };
}

async function publishPost(post: Post) {
  if (!post.video_url) throw new Error("Post is missing a final video URL.");
  if (!post.tiktok_privacy_level) {
    throw new Error("Choose a TikTok privacy level before publishing.");
  }

  const supabase = getSupabaseAdmin();
  const accessToken = await getAccessToken(post.account_id);
  const creatorInfo = await queryCreatorInfo(accessToken);
  ensureCreatorAllowsPost(creatorInfo, post);

  const video = await downloadBytes(post.video_url);
  if (
    !video.mimeType.includes("mp4") &&
    video.mimeType !== "application/octet-stream"
  ) {
    throw new Error(
      `TikTok Direct Post expects a TikTok-safe MP4; got ${video.mimeType}.`,
    );
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

  const init = await initDirectPost(accessToken, {
    title: titleForPost(post),
    privacyLevel: post.tiktok_privacy_level,
    disableDuet: post.tiktok_disable_duet,
    disableComment: post.tiktok_disable_comment,
    disableStitch: post.tiktok_disable_stitch,
    isAigc: post.tiktok_is_aigc,
    brandContentToggle: post.tiktok_brand_content,
    brandOrganicToggle: post.tiktok_brand_organic,
  }, video.bytes.byteLength);

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

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405);
  }

  const supabase = getSupabaseAdmin();
  const results: unknown[] = [];

  try {
    const posting = await supabase
      .from("posts")
      .select("*")
      .eq("status", "posting")
      .not("tiktok_publish_id", "is", null)
      .order("scheduled_at", { ascending: true })
      .limit(20);
    if (posting.error) throw posting.error;

    for (
      const post of await processOnePerAccount((posting.data ?? []) as Post[])
    ) {
      try {
        const accessToken = await getAccessToken(post.account_id);
        results.push(await applyPublishStatus(post, accessToken));
      } catch (error) {
        results.push(
          isRetryable(error)
            ? await backoffPost(post, error)
            : await failPost(post, error),
        );
      }
    }

    const due = await supabase
      .from("posts")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .not("video_url", "is", null)
      .not("tiktok_privacy_level", "is", null)
      .order("scheduled_at", { ascending: true })
      .limit(20);
    if (due.error) throw due.error;

    for (const post of await processOnePerAccount((due.data ?? []) as Post[])) {
      try {
        results.push(await publishPost(post));
      } catch (error) {
        results.push(
          isRetryable(error)
            ? await backoffPost(post, error)
            : await failPost(post, error),
        );
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
