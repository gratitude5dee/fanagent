import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { buildLyricBlocksFromTranscript } from "../_shared/library.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { transcribeAudioUrl, type Transcript } from "../_shared/transcribe.ts";

type RequestBody = {
  audioClipId?: string;
  force?: boolean;
};

async function urlForAsset(asset: {
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string;
}): Promise<string> {
  if (!asset.storage_bucket || !asset.storage_path) return asset.public_url;
  const supabase = getSupabaseAdmin();
  const signed = await supabase.storage
    .from(asset.storage_bucket)
    .createSignedUrl(asset.storage_path, 60 * 60);
  return signed.data?.signedUrl ?? asset.public_url;
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST")
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);

  const supabase = getSupabaseAdmin();
  let audioClipId: string | undefined;

  try {
    const body = (await request.json()) as RequestBody;
    audioClipId = body.audioClipId;
    if (!audioClipId) throw new Error("audioClipId is required.");

    const clip = await supabase.from("audio_clips").select("*").eq("id", audioClipId).single();
    if (clip.error) throw clip.error;

    const assetId = clip.data.trimmed_asset_id ?? clip.data.source_asset_id;
    const asset = await supabase.from("media_assets").select("*").eq("id", assetId).single();
    if (asset.error) throw asset.error;
    const audioAsset = asset.data;

    if (!body.force && clip.data.transcription_status === "ready" && audioAsset.transcript) {
      const transcript = audioAsset.transcript as Transcript;
      return okEnvelope({
        audio_clip: clip.data,
        transcript: {
          ...transcript,
          blocks: buildLyricBlocksFromTranscript(transcript),
        },
      });
    }

    await supabase
      .from("audio_clips")
      .update({ transcription_status: "running", updated_at: new Date().toISOString() })
      .eq("id", audioClipId);

    const transcript = await transcribeAudioUrl(await urlForAsset(audioAsset));
    const blocks = buildLyricBlocksFromTranscript(transcript);

    const mediaUpdate = await supabase
      .from("media_assets")
      .update({ transcript })
      .eq("id", audioAsset.id);
    if (mediaUpdate.error) throw mediaUpdate.error;

    const clipUpdate = await supabase
      .from("audio_clips")
      .update({ transcription_status: "ready", updated_at: new Date().toISOString() })
      .eq("id", audioClipId)
      .select("*")
      .single();
    if (clipUpdate.error) throw clipUpdate.error;

    return okEnvelope({
      audio_clip: clipUpdate.data,
      transcript: {
        ...transcript,
        blocks,
      },
    });
  } catch (error) {
    if (audioClipId) {
      await supabase
        .from("audio_clips")
        .update({ transcription_status: "failed", updated_at: new Date().toISOString() })
        .eq("id", audioClipId);
    }
    return errorEnvelope(error, "AUDIO_CLIP_TRANSCRIBE_FAILED", 500);
  }
});
