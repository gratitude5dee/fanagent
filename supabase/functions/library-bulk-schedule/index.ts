import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { refreshRenderableAssetUrls } from "../_shared/schedule-assets.ts";
import {
  buildBulkScheduleSlots,
  buildScheduledPostRow,
  scheduledPostResponse,
} from "../_shared/schedule.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type BlockedReason = {
  library_item_id: string;
  reason: string;
  detail: string;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function reasonFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("not ready")) return "NOT_READY";
  if (message.includes("final asset")) return "MISSING_FINAL_ASSET";
  if (message.includes("scheduledAt")) return "INVALID_SCHEDULE";
  return "SCHEDULE_FAILED";
}

function captionFromTemplate(template: unknown, item: Record<string, unknown>): string | undefined {
  if (typeof template !== "string" || !template.trim()) return undefined;
  return template.replace("{hookText}", String(item.default_caption ?? "sound on"));
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") {
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const libraryItemIds = Array.isArray(body.libraryItemIds)
      ? body.libraryItemIds.filter((id): id is string => typeof id === "string").slice(0, 50)
      : [];
    if (libraryItemIds.length === 0) throw new Error("libraryItemIds are required.");

    const slots = buildBulkScheduleSlots(libraryItemIds, record(body.rule));
    const supabase = getSupabaseAdmin();
    const library = await supabase.from("video_library_items").select("*").in("id", libraryItemIds);
    if (library.error) throw library.error;
    const itemById = new Map(
      ((library.data ?? []) as Record<string, unknown>[]).map((item) => [String(item.id), item]),
    );

    const assetIds = Array.from(
      new Set(
        Array.from(itemById.values())
          .map((item) => item.final_asset_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );
    const assetById = new Map<string, Record<string, unknown>>();
    if (assetIds.length > 0) {
      const assets = await supabase.from("media_assets").select("*").in("id", assetIds);
      if (assets.error) throw assets.error;
      for (const asset of (assets.data ?? []) as Record<string, unknown>[]) {
        assetById.set(String(asset.id), asset);
      }
    }
    const refreshedAssetById = await refreshRenderableAssetUrls(assetById);

    const rows: Record<string, unknown>[] = [];
    const blockedReasons: BlockedReason[] = [];
    for (const slot of slots) {
      const item = itemById.get(slot.libraryItemId);
      if (!item) {
        blockedReasons.push({
          library_item_id: slot.libraryItemId,
          reason: "NOT_FOUND",
          detail: "library item was not found",
        });
        continue;
      }
      try {
        rows.push(
          buildScheduledPostRow({
            item,
            asset:
              typeof item.final_asset_id === "string"
                ? refreshedAssetById.get(item.final_asset_id)
                : null,
            scheduledAt: slot.scheduledAt,
            caption: captionFromTemplate(body.captionTemplate, item),
            hashtags: Array.isArray(body.hashtags) ? body.hashtags.map(String) : undefined,
            tiktokOptions: body.tiktokOptions,
          }),
        );
      } catch (error) {
        blockedReasons.push({
          library_item_id: slot.libraryItemId,
          reason: reasonFromError(error),
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const insertedPosts =
      rows.length > 0
        ? await supabase.from("posts").insert(rows).select("*")
        : { data: [], error: null };
    if (insertedPosts.error) throw insertedPosts.error;

    const scheduledIds = rows.map((row) => String(row.library_item_id));
    if (scheduledIds.length > 0) {
      const updated = await supabase
        .from("video_library_items")
        .update({ status: "scheduled", updated_at: new Date().toISOString() })
        .in("id", scheduledIds);
      if (updated.error) throw updated.error;
    }

    const posts = ((insertedPosts.data ?? []) as Record<string, unknown>[]).map((post) =>
      scheduledPostResponse(
        post,
        typeof post.final_asset_id === "string"
          ? refreshedAssetById.get(post.final_asset_id)
          : null,
      ),
    );
    return okEnvelope({ posts, blocked: blockedReasons, blockedReasons });
  } catch (error) {
    return errorEnvelope(error, "LIBRARY_BULK_SCHEDULE_FAILED", 500);
  }
});
