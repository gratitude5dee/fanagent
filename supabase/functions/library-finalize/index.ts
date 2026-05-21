import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { isAuthorizedInternalCall } from "../_shared/internal.ts";
import { buildLibraryFinalizeUpdate, deriveBatchLibraryStatus } from "../_shared/library.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type RequestBody = {
  generationItemId?: string;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function refreshLibraryStatus(batchId: string): Promise<void> {
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

  const update = await supabase
    .from("generation_batches")
    .update({ library_status: libraryStatus, updated_at: new Date().toISOString() })
    .eq("id", batchId);
  if (update.error) throw update.error;
}

async function hydrateDraftPosts(input: {
  generationItemId: string;
  libraryItemId: string;
  finalAssetId: string;
  videoUrl: string;
  durationSeconds: number | null;
  thumbnailUrl?: string | null;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const posts = await supabase
    .from("posts")
    .select("id,publish_status,metadata")
    .or(`generation_item_id.eq.${input.generationItemId},library_item_id.eq.${input.libraryItemId}`)
    .neq("status", "posted");
  if (posts.error) throw posts.error;

  for (const post of posts.data ?? []) {
    const needsReview =
      post.publish_status === "blocked_render_not_ready" ||
      post.publish_status === "blocked_missing_video";
    const publishStatus = needsReview ? "blocked_review_required" : post.publish_status;
    const update: Record<string, unknown> = {
      final_asset_id: input.finalAssetId,
      video_url: input.videoUrl,
      publish_status: publishStatus,
      metadata: {
        ...record(post.metadata),
        render_ready: true,
        review_required: publishStatus === "blocked_review_required",
        final_asset_id: input.finalAssetId,
        library_item_id: input.libraryItemId,
        generation_item_id: input.generationItemId,
        duration_seconds: input.durationSeconds,
        thumbnail_url: input.thumbnailUrl ?? null,
      },
    };
    if (needsReview) {
      update.publish_error = "Render complete. Review and save this post before publishing.";
      update.error_message = "Render complete. Review and save this post before publishing.";
    }
    const updated = await supabase.from("posts").update(update).eq("id", post.id);
    if (updated.error) throw updated.error;
  }
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST")
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);
  if (!isAuthorizedInternalCall(request)) {
    return errorEnvelope("Unauthorized internal call.", "UNAUTHORIZED_INTERNAL", 401);
  }

  try {
    const body = (await request.json()) as RequestBody;
    if (!body.generationItemId) throw new Error("generationItemId is required.");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select(
        "id,account_id,batch_id,audio_clip_id,library_item_id,item_index,final_asset_id,duration_seconds,segments,perceptual_hash,input_payload",
      )
      .eq("id", body.generationItemId)
      .single();
    if (item.error) throw item.error;
    if (!item.data.final_asset_id) throw new Error("Generation item is missing final_asset_id.");

    const asset = await supabase
      .from("media_assets")
      .select("id,public_url,metadata")
      .eq("id", item.data.final_asset_id)
      .single();
    if (asset.error) throw asset.error;

    let libraryItemId = item.data.library_item_id as string | null;
    if (!libraryItemId) {
      const existing = await supabase
        .from("video_library_items")
        .select("id")
        .eq("generation_item_id", item.data.id)
        .maybeSingle();
      if (existing.error) throw existing.error;
      libraryItemId = existing.data?.id ?? null;
    }

    if (!libraryItemId) {
      if (!item.data.audio_clip_id) {
        throw new Error("Generation item is missing audio_clip_id and library_item_id.");
      }
      const inserted = await supabase
        .from("video_library_items")
        .insert({
          account_id: item.data.account_id,
          audio_clip_id: item.data.audio_clip_id,
          batch_id: item.data.batch_id,
          generation_item_id: item.data.id,
          library_index: item.data.item_index,
          status: "not_ready",
          duration_sec: item.data.duration_seconds,
        })
        .select("id")
        .single();
      if (inserted.error) throw inserted.error;
      libraryItemId = inserted.data.id;
    }
    if (!libraryItemId) {
      throw new Error("Unable to resolve a video library item for this generation item.");
    }

    const currentLibrary = await supabase
      .from("video_library_items")
      .select("metadata")
      .eq("id", libraryItemId)
      .maybeSingle();
    if (currentLibrary.error) throw currentLibrary.error;

    const libraryUpdate = buildLibraryFinalizeUpdate({
      item: item.data,
      asset: asset.data,
      libraryMetadata: currentLibrary.data?.metadata,
    });
    const assetMetadata = record(asset.data.metadata);

    const updatedLibrary = await supabase
      .from("video_library_items")
      .update({
        ...libraryUpdate,
        generation_item_id: item.data.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", libraryItemId)
      .select("*")
      .single();
    if (updatedLibrary.error) throw updatedLibrary.error;

    const updatedItem = await supabase
      .from("generation_items")
      .update({
        status: "complete",
        library_item_id: libraryItemId,
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.data.id);
    if (updatedItem.error) throw updatedItem.error;

    await hydrateDraftPosts({
      generationItemId: item.data.id,
      libraryItemId,
      finalAssetId: item.data.final_asset_id,
      videoUrl: asset.data.public_url,
      durationSeconds: item.data.duration_seconds,
      thumbnailUrl:
        typeof assetMetadata.thumbnail_url === "string" ? assetMetadata.thumbnail_url : null,
    });

    await refreshLibraryStatus(item.data.batch_id);

    return okEnvelope({
      library_item: updatedLibrary.data,
      generation_item_id: item.data.id,
    });
  } catch (error) {
    return errorEnvelope(error, "LIBRARY_FINALIZE_FAILED", 500);
  }
});
