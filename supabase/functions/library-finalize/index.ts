import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { buildLibraryFinalizeUpdate } from "../_shared/library.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type RequestBody = {
  generationItemId?: string;
};

async function refreshLibraryStatus(batchId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const rows = await supabase.from("video_library_items").select("status").eq("batch_id", batchId);
  if (rows.error) throw rows.error;

  const statuses = (rows.data ?? []).map((row) => row.status);
  if (statuses.length === 0) return;

  const readyCount = statuses.filter((status) =>
    ["ready", "scheduled", "posted"].includes(status),
  ).length;
  const failedCount = statuses.filter((status) => ["failed", "blocked"].includes(status)).length;
  const libraryStatus =
    readyCount === statuses.length
      ? "ready"
      : readyCount + failedCount === statuses.length
        ? "exhausted"
        : "building";

  const update = await supabase
    .from("generation_batches")
    .update({ library_status: libraryStatus, updated_at: new Date().toISOString() })
    .eq("id", batchId);
  if (update.error) throw update.error;
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST")
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);

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

    const libraryUpdate = buildLibraryFinalizeUpdate({
      item: item.data,
      asset: asset.data,
    });

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

    await refreshLibraryStatus(item.data.batch_id);

    return okEnvelope({
      library_item: updatedLibrary.data,
      generation_item_id: item.data.id,
    });
  } catch (error) {
    return errorEnvelope(error, "LIBRARY_FINALIZE_FAILED", 500);
  }
});
