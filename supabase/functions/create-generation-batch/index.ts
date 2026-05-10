import { createMediaAssetFromBytes, decodeBase64 } from "../_shared/assets.ts";
import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import {
  buildSchedule,
  createPromptPlan,
  type SourceMode,
} from "../_shared/generation.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type CreateBatchRequest = {
  accountId?: string;
  audioBase64?: string;
  audioMimeType?: string;
  audioFileName?: string;
  count?: number;
  sourceMode?: SourceMode;
  prompt?: string;
  startAt?: string;
  cadenceMinutes?: number;
  timezone?: string;
};

const supportedAudio = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
]);

function normalizeAudioBase64(value: string): string {
  return value.includes(",") ? value.split(",").at(-1) ?? "" : value;
}

function validatePayload(body: CreateBatchRequest) {
  const count = Math.max(1, Math.min(Math.floor(Number(body.count ?? 1)), 50));
  const cadenceMinutes = Math.max(
    5,
    Math.min(Math.floor(Number(body.cadenceMinutes ?? 240)), 10_080),
  );
  const sourceMode = body.sourceMode === "remote_render"
    ? "remote_render"
    : "gmi_seedance";
  const audioMimeType = body.audioMimeType || "audio/mpeg";
  const startAt = new Date(body.startAt ?? Date.now() + 30 * 60_000);

  if (!body.accountId) throw new Error("accountId is required.");
  if (!body.audioBase64) throw new Error("audioBase64 is required.");
  if (!supportedAudio.has(audioMimeType)) {
    throw new Error(`Unsupported audio MIME type: ${audioMimeType}`);
  }
  if (!Number.isFinite(startAt.getTime())) {
    throw new Error("startAt must be a valid ISO date.");
  }

  return {
    accountId: body.accountId,
    audioBytes: decodeBase64(normalizeAudioBase64(body.audioBase64)),
    audioMimeType,
    audioFileName: body.audioFileName || "audio-upload",
    count,
    cadenceMinutes,
    sourceMode,
    prompt: body.prompt ||
      "music-driven fan edit with cinematic lifestyle visuals",
    startAt,
    timezone: body.timezone || "America/Los_Angeles",
  };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405);
  }

  try {
    const supabase = getSupabaseAdmin();
    const input = validatePayload(await request.json());
    if (input.audioBytes.byteLength > 12 * 1024 * 1024) {
      throw new Error("Audio uploads are limited to 12MB.");
    }

    const audioAsset = await createMediaAssetFromBytes({
      accountId: input.accountId,
      kind: "audio",
      source: "upload",
      bytes: input.audioBytes,
      mimeType: input.audioMimeType,
      fileName: input.audioFileName,
      metadata: {
        original_name: input.audioFileName,
        uploaded_from: "fanagent-react",
      },
    });

    const batch = await supabase
      .from("generation_batches")
      .insert({
        account_id: input.accountId,
        audio_asset_id: audioAsset.id,
        source_mode: input.sourceMode,
        prompt: input.prompt,
        post_count: input.count,
        cadence_minutes: input.cadenceMinutes,
        timezone: input.timezone,
        status: "pending",
      })
      .select("*")
      .single();

    if (batch.error) throw batch.error;

    const schedule = buildSchedule(
      input.startAt,
      input.count,
      input.cadenceMinutes,
    );
    const modelId = input.sourceMode === "gmi_seedance"
      ? optionalEnv("GMI_SEEDANCE_MODEL_ID") ?? "Seedance-2.0"
      : optionalEnv("REMOTE_RENDER_MODEL_ID") ?? "remote-render-v1";

    const items = schedule.map((scheduledAt, index) => {
      const promptPlan = createPromptPlan({
        basePrompt: input.prompt,
        index,
        total: input.count,
        durationSeconds: 15,
      });

      return {
        batch_id: batch.data.id,
        account_id: input.accountId,
        item_index: index,
        status: "pending",
        provider: input.sourceMode,
        model_id: modelId,
        prompt: promptPlan.prompt,
        input_payload: {
          source_mode: input.sourceMode,
          prompt_plan: promptPlan,
          audio_asset_id: audioAsset.id,
        },
        scheduled_at: scheduledAt.toISOString(),
        duration_seconds: promptPlan.videoPrompt.duration_seconds,
      };
    });

    const insertedItems = await supabase.from("generation_items").insert(items)
      .select("*");
    if (insertedItems.error) throw insertedItems.error;

    return jsonResponse({
      batch: batch.data,
      audioAsset,
      items: insertedItems.data,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
