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
  isAigc?: boolean;
  brandContentToggle?: boolean;
  brandOrganicToggle?: boolean;
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
  const now = Date.now();
  const minPast = now - 60 * 1000;
  const maxFuture = now + 90 * 24 * 60 * 60 * 1000;
  if (scheduledAt.getTime() < minPast) {
    throw new Error("scheduledAt cannot be more than 1 minute in the past.");
  }
  if (scheduledAt.getTime() > maxFuture) {
    throw new Error("scheduledAt cannot be more than 90 days in the future.");
  }
}

async function hasTikTokConnection(accountId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const account = await supabase
    .from("accounts")
    .select("tiktok_access_token_encrypted,tiktok_connected_at")
    .eq("id", accountId)
    .maybeSingle();
  if (account.error) throw account.error;
  return Boolean(account.data?.tiktok_access_token_encrypted || account.data?.tiktok_connected_at);
}

function publishReadiness(input: {
  finalAssetId?: string | null;
  videoUrl?: string | null;
  privacyLevel?: string | null;
  tiktokConnected: boolean;
}): { status: string; message: string | null } {
  if (!input.finalAssetId && !input.videoUrl) {
    return {
      status: "blocked_render_not_ready",
      message: "Video is still rendering. Review the post after the render finishes.",
    };
  }
  if (!input.privacyLevel) {
    return {
      status: "blocked_missing_privacy",
      message: "Choose a TikTok privacy level before publishing.",
    };
  }
  if (!input.tiktokConnected) {
    return {
      status: "blocked_account_not_connected",
      message: "Connect TikTok to auto-post.",
    };
  }
  return { status: "ready", message: null };
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
      .select(
        "id,status,privacy_settings,account_id,library_item_id,final_asset_id,video_url,tiktok_privacy_level",
      )
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
    if (typeof body.isAigc === "boolean") {
      update.tiktok_is_aigc = body.isAigc;
    }
    if (typeof body.brandContentToggle === "boolean") {
      update.tiktok_brand_content = body.brandContentToggle;
    }
    if (typeof body.brandOrganicToggle === "boolean") {
      update.tiktok_brand_organic = body.brandOrganicToggle;
    }
    if (body.privacySettings && typeof body.privacySettings === "object") {
      update.privacy_settings = {
        ...record(current.data.privacy_settings),
        ...body.privacySettings,
      };
    }

    const nextPrivacyLevel =
      body.privacyLevel === undefined
        ? current.data.tiktok_privacy_level
        : body.privacyLevel || null;
    const readiness = publishReadiness({
      finalAssetId: current.data.final_asset_id,
      videoUrl: current.data.video_url,
      privacyLevel: nextPrivacyLevel,
      tiktokConnected: await hasTikTokConnection(current.data.account_id),
    });
    update.publish_status = readiness.status;
    update.publish_error = readiness.message;
    update.error_message = readiness.message;

    const updated = await supabase
      .from("posts")
      .update(update)
      .eq("id", body.postId)
      .select("*")
      .single();
    if (updated.error) throw updated.error;

    if (readiness.status === "ready" && current.data.library_item_id) {
      const library = await supabase
        .from("video_library_items")
        .update({ status: "scheduled", updated_at: new Date().toISOString() })
        .eq("id", current.data.library_item_id)
        .eq("status", "ready");
      if (library.error) throw library.error;
    }

    return okEnvelope({ post: updated.data });
  } catch (error) {
    return errorEnvelope(error, "UPDATE_POST_SCHEDULE_FAILED", 500);
  }
});
