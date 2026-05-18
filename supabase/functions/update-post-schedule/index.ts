import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
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
  privacySettings?: Record<string, unknown>;
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

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assertWithinScheduleWindow(scheduledAt: Date): void {
  const maxFuture = Date.now() + 90 * 24 * 60 * 60 * 1000;
  if (scheduledAt.getTime() > maxFuture) {
    throw new Error("scheduledAt cannot be more than 90 days in the future.");
  }
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST" && request.method !== "PATCH") {
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);
  }

  try {
    const body = (await request.json()) as UpdatePostRequest;
    if (!body.postId) throw new Error("postId is required.");

    const supabase = getSupabaseAdmin();
    const current = await supabase
      .from("posts")
      .select("id,status,privacy_settings")
      .eq("id", body.postId)
      .single();
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
      assertWithinScheduleWindow(scheduledAt);
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
        body.privacyLevel !== null &&
        body.privacyLevel !== "" &&
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
    if (body.privacySettings && typeof body.privacySettings === "object") {
      update.privacy_settings = {
        ...record(current.data.privacy_settings),
        ...body.privacySettings,
      };
    }

    const updated = await supabase
      .from("posts")
      .update(update)
      .eq("id", body.postId)
      .select("*")
      .single();
    if (updated.error) throw updated.error;

    return okEnvelope({ post: updated.data });
  } catch (error) {
    return errorEnvelope(error, "UPDATE_POST_SCHEDULE_FAILED", 500);
  }
});
