// Dispatches a Remotion render job to the configured hosted SaaS render host.
// Stores render_job_id + render_callback_token onto the generation_item.
// If REMOTION_RENDER_* env is missing, falls back to a no-op stub that marks
// the item ready using the stock clip URL directly (useful while the render
// host is being provisioned).

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

function projectFunctionsUrl(path: string): string {
  const url = optionalEnv("SUPABASE_URL") ?? "";
  return `${url}/functions/v1/${path}`;
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = await request.json() as { itemId?: string };
    if (!body.itemId) throw new Error("itemId is required");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select(
        "id,account_id,batch_id,stock_clip_url,input_payload,duration_seconds",
      )
      .eq("id", body.itemId)
      .single();
    if (item.error) throw item.error;
    if (!item.data.stock_clip_url) {
      throw new Error("Item has no stock_clip_url; pick-stock-clip first");
    }

    const batch = await supabase
      .from("generation_batches")
      .select("audio_asset_id")
      .eq("id", item.data.batch_id)
      .single();
    if (batch.error) throw batch.error;

    const audio = await supabase
      .from("media_assets")
      .select("public_url,transcript")
      .eq("id", batch.data.audio_asset_id)
      .single();
    if (audio.error) throw audio.error;

    const renderEndpoint = optionalEnv("REMOTION_RENDER_ENDPOINT");
    const renderApiKey = optionalEnv("REMOTION_RENDER_API_KEY");
    const serveUrl = optionalEnv("REMOTION_SERVE_URL");

    const callbackToken = crypto.randomUUID();
    const inputProps = {
      audioUrl: audio.data.public_url,
      stockClipUrl: item.data.stock_clip_url,
      transcript: audio.data.transcript ?? { words: [] },
      durationFrames: (item.data.duration_seconds ?? 15) * 30,
      fps: 30,
    };

    if (!renderEndpoint || !renderApiKey || !serveUrl) {
      // STUB FALLBACK: mark the item ready using the stock clip directly so
      // the rest of the pipeline (publish) can be exercised end-to-end.
      const updated = await supabase
        .from("generation_items")
        .update({
          status: "ready",
          render_provider: "stub",
          render_callback_token: callbackToken,
          input_payload: { ...item.data.input_payload, render: inputProps },
        })
        .eq("id", body.itemId);
      if (updated.error) throw updated.error;
      // Reuse the stock clip as the "rendered" video url for now.
      const post = await supabase
        .from("posts")
        .update({ video_url: item.data.stock_clip_url, status: "pending" })
        .eq("generation_item_id", body.itemId);
      if (post.error) throw post.error;
      return jsonResponse({
        itemId: body.itemId,
        mode: "stub",
        message: "REMOTION_RENDER_* not configured; using stock clip as final.",
      });
    }

    const callbackUrl = projectFunctionsUrl(
      `render-callback?token=${callbackToken}&itemId=${body.itemId}`,
    );

    const dispatch = await fetch(renderEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${renderApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        serveUrl,
        composition: "KaraokeFanpage",
        inputProps,
        webhook: { url: callbackUrl, method: "POST" },
        codec: "h264",
      }),
    });
    if (!dispatch.ok) {
      const errText = await dispatch.text();
      throw new Error(`Remotion dispatch failed [${dispatch.status}]: ${errText}`);
    }
    const dispatchJson = await dispatch.json() as { id?: string; jobId?: string };
    const jobId = dispatchJson.id ?? dispatchJson.jobId ?? "";

    const updated = await supabase
      .from("generation_items")
      .update({
        status: "rendering",
        render_provider: "remotion_saas",
        render_job_id: jobId,
        render_callback_token: callbackToken,
        input_payload: { ...item.data.input_payload, render: inputProps },
      })
      .eq("id", body.itemId);
    if (updated.error) throw updated.error;

    return jsonResponse({ itemId: body.itemId, mode: "saas", jobId });
  } catch (error) {
    return errorResponse(error);
  }
});
