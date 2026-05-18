import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { buildScheduledPostRow, scheduledPostResponse } from "../_shared/schedule.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type ScheduleRequestItem = {
  libraryItemId?: string;
  scheduledAt?: string;
  caption?: string;
  hashtags?: string[];
  tiktokOptions?: unknown;
};

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

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") {
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);
  }

  try {
    const body = (await request.json()) as { items?: ScheduleRequestItem[] };
    const requested = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
    if (requested.length === 0) throw new Error("items are required.");

    const supabase = getSupabaseAdmin();
    const ids = requested
      .map((item) => item.libraryItemId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const library = await supabase.from("video_library_items").select("*").in("id", ids);
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

    const rows: Record<string, unknown>[] = [];
    const blockedReasons: BlockedReason[] = [];
    for (const requestedItem of requested) {
      const libraryItemId = requestedItem.libraryItemId ?? "";
      const item = itemById.get(libraryItemId);
      if (!item) {
        blockedReasons.push({
          library_item_id: libraryItemId,
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
              typeof item.final_asset_id === "string" ? assetById.get(item.final_asset_id) : null,
            scheduledAt: requestedItem.scheduledAt ?? "",
            caption: requestedItem.caption,
            hashtags: requestedItem.hashtags,
            tiktokOptions: requestedItem.tiktokOptions,
          }),
        );
      } catch (error) {
        blockedReasons.push({
          library_item_id: libraryItemId,
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
        typeof post.final_asset_id === "string" ? assetById.get(post.final_asset_id) : null,
      ),
    );
    return okEnvelope({ posts, blocked: blockedReasons, blockedReasons });
  } catch (error) {
    return errorEnvelope(error, "LIBRARY_SCHEDULE_FAILED", 500);
  }
});
