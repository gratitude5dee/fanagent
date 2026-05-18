import { createMediaAssetFromBytes } from "../_shared/assets.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { handleOptions } from "../_shared/cors.ts";
import { normalizeAudioClipRequest } from "../_shared/library.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST")
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);

  try {
    const input = normalizeAudioClipRequest(await request.json());
    const supabase = getSupabaseAdmin();
    const extension = input.audioFileName.split(".").pop()?.toLowerCase() || "wav";
    const storagePath = `${input.accountId}/${crypto.randomUUID()}.${extension}`;

    const media = await createMediaAssetFromBytes({
      accountId: input.accountId,
      kind: "audio",
      source: "upload",
      bytes: input.audioBytes,
      mimeType: input.audioMimeType,
      fileName: input.audioFileName,
      storageBucket: "audio-uploads",
      storagePath,
      metadata: {
        original_name: input.audioFileName,
        uploaded_from: "fanagent-audio-clip-register",
        clip_selection: input.clipSelection,
      },
    });

    const audioClip = await supabase
      .from("audio_clips")
      .insert({
        account_id: input.accountId,
        source_asset_id: media.id,
        trimmed_asset_id: media.id,
        selection_start_sec: input.clipSelection.startSec,
        selection_end_sec: input.clipSelection.endSec,
        duration_sec: input.clipSelection.durationSec,
        file_name: input.audioFileName,
        transcription_status: "pending",
        metadata: {
          audio_mime_type: input.audioMimeType,
          byte_size: input.audioBytes.byteLength,
        },
      })
      .select("*")
      .single();

    if (audioClip.error) throw audioClip.error;

    return okEnvelope({
      audio_clip: {
        id: audioClip.data.id,
        duration_sec: audioClip.data.duration_sec,
        file_name: audioClip.data.file_name,
        perceptual_hash: audioClip.data.perceptual_hash,
        transcription_status: audioClip.data.transcription_status,
        selection_start_sec: audioClip.data.selection_start_sec,
        selection_end_sec: audioClip.data.selection_end_sec,
      },
      media: {
        asset_id: media.id,
        public_url: media.public_url,
        mime_type: media.mime_type,
        duration_seconds: audioClip.data.duration_sec,
        source: {
          type: "audio",
          provider: "upload",
          external_id: null,
          license: null,
          attribution: null,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /Unsupported audio MIME type/i.test(message)
      ? "INVALID_AUDIO_MIME"
      : /durationSec/i.test(message)
        ? "INVALID_CLIP_DURATION"
        : "AUDIO_CLIP_REGISTER_FAILED";
    return errorEnvelope(error, code, code === "AUDIO_CLIP_REGISTER_FAILED" ? 500 : 400);
  }
});
