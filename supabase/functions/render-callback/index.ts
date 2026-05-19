// Webhook receiver for the Remotion hosted render service. The query string
// must contain `token` (matching generation_items.render_callback_token) and
// `itemId`. The body is expected to contain { url } pointing at the final MP4.

import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { downloadBytes } from "../_shared/assets.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;

  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const itemId = url.searchParams.get("itemId");
    if (!token || !itemId) throw new Error("Missing token or itemId");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select("id,account_id,render_callback_token")
      .eq("id", itemId)
      .single();
    if (item.error) throw item.error;
    if (item.data.render_callback_token !== token) {
      return errorEnvelope("Invalid callback token", "INVALID_CALLBACK_TOKEN", 401);
    }

    const body = await request.json() as {
      url?: string;
      videoUrl?: string;
      output?: string;
      error?: string;
    };
    if (body.error) {
      await supabase
        .from("generation_items")
        .update({ status: "failed", error_message: body.error })
        .eq("id", itemId);
      return okEnvelope({ status: "failed" });
    }
    const finalUrl = body.url ?? body.videoUrl ?? body.output;
    if (!finalUrl) throw new Error("Callback missing video url");

    // Stream the MP4 into the private renders bucket so the asset is durable.
    const { bytes } = await downloadBytes(finalUrl);
    const path = `${itemId}.mp4`;
    const upload = await supabase.storage.from("renders").upload(path, bytes, {
      contentType: "video/mp4",
      upsert: true,
    });
    if (upload.error) throw upload.error;
    const signed = await supabase.storage.from("renders").createSignedUrl(
      path,
      60 * 60 * 24 * 7,
    );
    if (signed.error || !signed.data) throw signed.error;

    const asset = await supabase
      .from("media_assets")
      .insert({
        account_id: item.data.account_id,
        kind: "rendered_video",
        source: "remotion_saas",
        storage_bucket: "renders",
        storage_path: path,
        public_url: signed.data.signedUrl,
        mime_type: "video/mp4",
        byte_size: bytes.byteLength,
      })
      .select("id")
      .single();
    if (asset.error) throw asset.error;

    await supabase
      .from("generation_items")
      .update({ status: "ready", final_asset_id: asset.data.id })
      .eq("id", itemId);

    await supabase
      .from("posts")
      .update({
        video_url: signed.data.signedUrl,
        final_asset_id: asset.data.id,
        status: "pending",
      })
      .eq("generation_item_id", itemId);

    return okEnvelope({ status: "ready" });
  } catch (error) {
    return errorEnvelope(error, "RENDER_CALLBACK_FAILED", 500);
  }
});
