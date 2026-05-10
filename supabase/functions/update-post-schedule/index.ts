import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type UpdatePostRequest = {
  postId?: string;
  scheduledAt?: string;
  caption?: string;
  hashtags?: string[];
  privacyLevel?: string | null;
  disableDuet?: boolean;
  disableStitch?: boolean;
  disableComment?: boolean;
};

const privacyLevels = new Set([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);

function normalizeHashtags(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  return values
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .slice(0, 20);
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST" && request.method !== "PATCH") {
    return errorResponse("Method not allowed.", 405);
  }

  try {
    const body = (await request.json()) as UpdatePostRequest;
    if (!body.postId) throw new Error("postId is required.");

    const supabase = getSupabaseAdmin();
    const current = await supabase.from("posts").select("id,status").eq(
      "id",
      body.postId,
    ).single();
    if (current.error) throw current.error;
    if (current.data.status === "posted") {
      throw new Error("Posted TikToks cannot be rescheduled.");
    }

    const update: Record<string, unknown> = {};
    if (body.scheduledAt) {
      const scheduledAt = new Date(body.scheduledAt);
      if (!Number.isFinite(scheduledAt.getTime())) {
        throw new Error("scheduledAt must be a valid ISO date.");
      }
      update.scheduled_at = scheduledAt.toISOString();
    }
    if (typeof body.caption === "string") {
      update.caption = body.caption.trim().slice(0, 2200);
    }
    if (Array.isArray(body.hashtags)) {
      update.hashtags = normalizeHashtags(body.hashtags);
    }
    if (body.privacyLevel !== undefined) {
      if (
        body.privacyLevel !== null && body.privacyLevel !== "" &&
        !privacyLevels.has(body.privacyLevel)
      ) {
        throw new Error("Unsupported TikTok privacy level.");
      }
      update.tiktok_privacy_level = body.privacyLevel || null;
    }
    if (typeof body.disableDuet === "boolean") {
      update.tiktok_disable_duet = body.disableDuet;
    }
    if (typeof body.disableStitch === "boolean") {
      update.tiktok_disable_stitch = body.disableStitch;
    }
    if (typeof body.disableComment === "boolean") {
      update.tiktok_disable_comment = body.disableComment;
    }

    const updated = await supabase.from("posts").update(update).eq(
      "id",
      body.postId,
    ).select("*").single();
    if (updated.error) throw updated.error;

    return jsonResponse({ post: updated.data });
  } catch (error) {
    return errorResponse(error);
  }
});
