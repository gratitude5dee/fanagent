import { createMediaAssetFromBytes, decodeBase64 } from "../_shared/assets.ts";
import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { optionalEnv } from "../_shared/env.ts";
import {
  buildBatchSettings,
  buildGenerationItemInputPayload,
  buildSchedule,
  createPromptPlan,
  normalizeSourceMode,
  normalizeClipSelection,
  type SourceMode,
} from "../_shared/generation.ts";
import { buildLibrarySlotRows } from "../_shared/library.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { isAuthorizedInternalCall } from "../_shared/internal.ts";

type CreateBatchRequest = {
  accountId?: string;
  audioBase64?: string;
  audioClipId?: string;
  audioMimeType?: string;
  audioFileName?: string;
  count?: number;
  postCount?: number;
  quantity?: number;
  sourceMode?: SourceMode;
  prompt?: string;
  startAt?: string;
  cadenceMinutes?: number;
  timezone?: string;
  durationSeconds?: number;
  lyricTemplateId?: string | null;
  clipSelection?: unknown;
  durationTolerance?: {
    preferredSeconds?: number;
    fallbackSeconds?: number;
  };
  dedupeStrategy?: string;
  stockSettings?: Record<string, unknown>;
  seedanceSettings?: Record<string, unknown>;
  publishDefaults?: Record<string, unknown>;
};

const supportedAudio = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/x-flac",
]);

function normalizeAudioBase64(value: string): string {
  return value.includes(",") ? (value.split(",").at(-1) ?? "") : value;
}

function validatePayload(body: CreateBatchRequest) {
  const count = Math.max(
    1,
    Math.min(Math.floor(Number(body.quantity ?? body.count ?? body.postCount ?? 1)), 250),
  );
  const cadenceMinutes = Math.max(
    5,
    Math.min(Math.floor(Number(body.cadenceMinutes ?? 240)), 10_080),
  );
  const allowedDurations = [15, 30, 45, 60, 75, 90];
  const requestedDuration = Math.floor(Number(body.durationSeconds ?? 15));
  const durationSeconds = allowedDurations.includes(requestedDuration) ? requestedDuration : 15;
  const sourceMode = normalizeSourceMode(body.sourceMode);
  const audioMimeType = body.audioMimeType || "audio/mpeg";
  const startAt = new Date(body.startAt ?? Date.now() + 30 * 60_000);
  const clipSelection =
    normalizeClipSelection(body.clipSelection, durationSeconds, body.audioFileName) ??
    (body.audioClipId
      ? null
      : {
          startSec: 0,
          endSec: durationSeconds,
          durationSec: durationSeconds,
          originalFileName: body.audioFileName,
        });
  const durationTolerance = {
    preferredSeconds: Math.max(
      1,
      Math.min(Math.floor(Number(body.durationTolerance?.preferredSeconds ?? 5)), 10),
    ),
    fallbackSeconds: Math.max(
      1,
      Math.min(Math.floor(Number(body.durationTolerance?.fallbackSeconds ?? 10)), 10),
    ),
  };
  const dedupeStrategy = ["strict", "allow_reuse_after_exhaustion", "allow_reuse_freely"].includes(
    String(body.dedupeStrategy),
  )
    ? String(body.dedupeStrategy)
    : "strict";

  if (!body.accountId) throw new Error("accountId is required.");
  if (!body.audioClipId && !body.audioBase64) {
    throw new Error("audioClipId or audioBase64 is required.");
  }
  if (body.audioBase64 && !supportedAudio.has(audioMimeType)) {
    throw new Error(`Unsupported audio MIME type: ${audioMimeType}`);
  }
  if (!Number.isFinite(startAt.getTime())) {
    throw new Error("startAt must be a valid ISO date.");
  }

  return {
    accountId: body.accountId,
    audioClipId: body.audioClipId ?? null,
    audioBytes: body.audioBase64 ? decodeBase64(normalizeAudioBase64(body.audioBase64)) : null,
    audioMimeType,
    audioFileName: body.audioFileName || "audio-upload",
    count,
    cadenceMinutes,
    sourceMode,
    prompt: body.prompt || "music-driven fan edit with cinematic lifestyle visuals",
    startAt,
    timezone: body.timezone || "America/Los_Angeles",
    durationSeconds,
    durationTolerance,
    dedupeStrategy,
    lyricTemplateId: body.lyricTemplateId ?? null,
    clipSelection,
    stockSettings: body.stockSettings ?? {},
    seedanceSettings: body.seedanceSettings ?? {},
    publishDefaults: {
      privacyLevel: "SELF_ONLY",
      disableDuet: true,
      disableStitch: true,
      disableComment: false,
      ...(body.publishDefaults ?? {}),
    },
  };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") {
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);
  }
  if (!isAuthorizedInternalCall(request)) {
    return errorEnvelope("Unauthorized internal call.", "UNAUTHORIZED_INTERNAL", 401);
  }

  try {
    const supabase = getSupabaseAdmin();
    const input = validatePayload(await request.json());
    if (input.audioBytes && input.audioBytes.byteLength > 50 * 1024 * 1024) {
      throw new Error("Audio uploads are limited to 50MB.");
    }

    let audioAsset: Record<string, unknown>;
    let audioClip: Record<string, unknown>;

    if (input.audioClipId) {
      const clip = await supabase
        .from("audio_clips")
        .select("*")
        .eq("id", input.audioClipId)
        .single();
      if (clip.error) throw clip.error;
      audioClip = clip.data;
      const assetId = clip.data.trimmed_asset_id ?? clip.data.source_asset_id;
      const asset = await supabase.from("media_assets").select("*").eq("id", assetId).single();
      if (asset.error) throw asset.error;
      audioAsset = asset.data;
      input.durationSeconds = Number(clip.data.duration_sec ?? input.durationSeconds);
    } else {
      const ext = input.audioFileName.split(".").pop()?.toLowerCase() || "wav";
      const storagePath = `${input.accountId}/${crypto.randomUUID()}.${ext}`;
      audioAsset = await createMediaAssetFromBytes({
        accountId: input.accountId,
        kind: "audio",
        source: "upload",
        bytes: input.audioBytes!,
        mimeType: input.audioMimeType,
        fileName: input.audioFileName,
        storageBucket: "audio-uploads",
        storagePath,
        metadata: {
          original_name: input.audioFileName,
          uploaded_from: "create-generation-batch",
          ...(input.clipSelection ? { clip_selection: input.clipSelection } : {}),
        },
      });
      const clip = await supabase
        .from("audio_clips")
        .insert({
          account_id: input.accountId,
          source_asset_id: audioAsset.id,
          trimmed_asset_id: audioAsset.id,
          selection_start_sec: input.clipSelection?.startSec ?? 0,
          selection_end_sec: input.clipSelection?.endSec ?? input.durationSeconds,
          duration_sec: input.durationSeconds,
          file_name: input.audioFileName,
          transcription_status: "pending",
          metadata: { created_from: "create-generation-batch" },
        })
        .select("*")
        .single();
      if (clip.error) throw clip.error;
      audioClip = clip.data;
    }

    const batch = await supabase
      .from("generation_batches")
      .insert({
        account_id: input.accountId,
        audio_asset_id: audioAsset.id,
        audio_clip_id: audioClip.id,
        source_mode: input.sourceMode,
        prompt: input.prompt,
        post_count: input.count,
        quantity: input.count,
        cadence_minutes: input.cadenceMinutes,
        timezone: input.timezone,
        status: "pending",
        duration_seconds: input.durationSeconds,
        duration_tolerance_seconds: input.durationTolerance.preferredSeconds,
        duration_tolerance_fallback_seconds: input.durationTolerance.fallbackSeconds,
        dedupe_strategy: input.dedupeStrategy,
        library_status: "building",
        lyric_template_id: input.lyricTemplateId,
        settings: buildBatchSettings({
          stockSettings: input.stockSettings,
          seedanceSettings: input.seedanceSettings,
          clipSelection: input.clipSelection,
        }),
        publish_defaults: input.publishDefaults,
      })
      .select("*")
      .single();

    if (batch.error) throw batch.error;

    const libraryRows = buildLibrarySlotRows({
      accountId: input.accountId,
      audioClipId: String(audioClip.id),
      batchId: batch.data.id,
      quantity: input.count,
      durationSec: input.durationSeconds,
    });
    const insertedLibraryItems = await supabase
      .from("video_library_items")
      .insert(libraryRows)
      .select("*");
    if (insertedLibraryItems.error) throw insertedLibraryItems.error;
    const libraryItemsByIndex = new Map(
      (insertedLibraryItems.data ?? []).map((row) => [Number(row.library_index), row]),
    );

    const schedule = buildSchedule(input.startAt, input.count, input.cadenceMinutes);
    const modelId =
      input.sourceMode === "seedance" || input.sourceMode === "mixed"
        ? (optionalEnv("SEEDANCE_MODEL_ID") ?? "bytedance/seedance-2.0/fast/text-to-video")
        : input.sourceMode === "gmi_seedance"
          ? (optionalEnv("GMI_SEEDANCE_MODEL_ID") ?? "Seedance-2.0")
          : "stock-pipeline";

    const items = schedule.map((scheduledAt, index) => {
      const libraryItem = libraryItemsByIndex.get(index);
      const promptPlan = createPromptPlan({
        basePrompt: input.prompt,
        index,
        total: input.count,
        durationSeconds: input.durationSeconds as 15 | 30 | 45 | 60 | 75 | 90,
      });

      return {
        batch_id: batch.data.id,
        account_id: input.accountId,
        audio_clip_id: audioClip.id,
        library_item_id: libraryItem?.id ?? null,
        item_index: index,
        status: "pending",
        provider: input.sourceMode,
        model_id: modelId,
        prompt: promptPlan.prompt,
        input_payload: buildGenerationItemInputPayload({
          sourceMode: input.sourceMode,
          promptPlan,
          audioAssetId: String(audioAsset.id),
          audioClipId: String(audioClip.id),
          libraryItemId: libraryItem?.id ?? null,
          durationSeconds: input.durationSeconds,
          durationTolerance: input.durationTolerance,
          stockSettings: input.stockSettings,
          seedanceSettings: input.seedanceSettings,
          publishDefaults: input.publishDefaults,
          clipSelection: input.clipSelection,
        }),
        scheduled_at: scheduledAt.toISOString(),
        duration_seconds: input.durationSeconds,
        lyric_template_id: input.lyricTemplateId,
      };
    });

    const insertedItems = await supabase.from("generation_items").insert(items).select("*");
    if (insertedItems.error) throw insertedItems.error;

    return okEnvelope({
      batch: batch.data,
      audio_clip: audioClip,
      audio_asset: audioAsset,
      audioClip,
      audioAsset,
      video_library_items: insertedLibraryItems.data,
      items: insertedItems.data,
      items_total: insertedItems.data?.length ?? 0,
    });
  } catch (error) {
    return errorEnvelope(error, "CREATE_GENERATION_BATCH_FAILED", 500);
  }
});
