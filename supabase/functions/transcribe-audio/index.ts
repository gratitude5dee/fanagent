// Transcribes a media_assets audio row with ElevenLabs Scribe v2 and
// persists { language, text, words[] } onto media_assets.transcript.
// Idempotent: re-running re-transcribes (caller decides when).

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { transcribeAudioUrl } from "../_shared/transcribe.ts";

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = await request.json() as { audioAssetId?: string };
    if (!body.audioAssetId) throw new Error("audioAssetId is required");

    const supabase = getSupabaseAdmin();
    const asset = await supabase
      .from("media_assets")
      .select("id,public_url,kind,transcript")
      .eq("id", body.audioAssetId)
      .single();
    if (asset.error) throw asset.error;
    if (asset.data.kind !== "audio") {
      throw new Error(`Asset is not audio (kind=${asset.data.kind})`);
    }

    const transcript = await transcribeAudioUrl(asset.data.public_url);

    const updated = await supabase
      .from("media_assets")
      .update({ transcript })
      .eq("id", body.audioAssetId);
    if (updated.error) throw updated.error;

    return jsonResponse({
      audioAssetId: body.audioAssetId,
      language: transcript.language,
      wordCount: transcript.words.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
