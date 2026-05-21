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
  categoryId?: string | null;
  subcategorySlug?: string | null;
  randomize?: boolean;
  autoRender?: boolean;
  autoDraftSchedule?: boolean;
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
  const autoRender =
    typeof body.autoRender === "boolean" ? body.autoRender : !!body.lyricTemplateId;
  const autoDraftSchedule = body.autoDraftSchedule !== false;
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
  const renderStartAt = autoRender ? new Date(Date.now() - 60_000) : startAt;
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
    renderStartAt,
    timezone: body.timezone || "America/Los_Angeles",
    durationSeconds,
    durationTolerance,
    dedupeStrategy,
    lyricTemplateId: body.lyricTemplateId ?? null,
    clipSelection,
    stockSettings: {
      // Default to category-locked sourcing when a category was picked so
      // a "Basketball" campaign cannot leak into unrelated stock footage.
      ...(body.categoryId ? { lockCategory: true } : {}),
      ...(body.stockSettings ?? {}),
    },

    seedanceSettings: body.seedanceSettings ?? {},
    publishDefaults: {
      privacyLevel: "SELF_ONLY",
      disableDuet: true,
      disableStitch: true,
      disableComment: false,
      ...(body.publishDefaults ?? {}),
    },
    categoryId: body.categoryId ?? null,
    subcategorySlug: body.subcategorySlug ?? null,
    randomize: body.randomize === true,
    autoRender,
    autoDraftSchedule,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 20) : [];
}

function buildDraftPostRow(input: {
  accountId: string;
  batchId: string;
  item: Record<string, unknown>;
  scheduledAt: Date;
  publishDefaults: Record<string, unknown>;
}): Record<string, unknown> {
  const payload = record(input.item.input_payload);
  const promptPlan = record(payload.prompt_plan);
  const publishDefaults = input.publishDefaults;
  const privacyLevel = String(
    publishDefaults.privacyLevel ?? publishDefaults.privacy_level ?? "SELF_ONLY",
  );
  const caption =
    String(promptPlan.caption ?? publishDefaults.caption ?? "sound on").trim() || "sound on";
  return {
    account_id: input.accountId,
    batch_id: input.batchId,
    generation_item_id: input.item.id,
    library_item_id: input.item.library_item_id ?? null,
    final_asset_id: null,
    video_url: null,
    caption: caption.slice(0, 2200),
    hashtags: stringArray(promptPlan.hashtags ?? publishDefaults.hashtags),
    hook_text: typeof promptPlan.hookText === "string" ? promptPlan.hookText : null,
    scheduled_at: input.scheduledAt.toISOString(),
    status: "pending",
    publish_status: "blocked_render_not_ready",
    publish_error: "Video is still rendering. Review the post after the render finishes.",
    error_message: "Video is still rendering. Review the post after the render finishes.",
    platform: "tiktok",
    post_type: "video",
    tiktok_privacy_level: privacyLevel,
    tiktok_disable_duet: bool(publishDefaults.disableDuet ?? publishDefaults.disable_duet, true),
    tiktok_disable_stitch: bool(
      publishDefaults.disableStitch ?? publishDefaults.disable_stitch,
      true,
    ),
    tiktok_disable_comment: bool(
      publishDefaults.disableComment ?? publishDefaults.disable_comment,
      false,
    ),
    tiktok_is_aigc: bool(publishDefaults.isAigc ?? publishDefaults.is_aigc, true),
    tiktok_brand_content: bool(
      publishDefaults.brandContentToggle ?? publishDefaults.brand_content_toggle,
      false,
    ),
    tiktok_brand_organic: bool(
      publishDefaults.brandOrganicToggle ?? publishDefaults.brand_organic_toggle,
      false,
    ),
    privacy_settings: {
      privacy_level: privacyLevel,
      disable_duet: bool(publishDefaults.disableDuet ?? publishDefaults.disable_duet, true),
      disable_stitch: bool(publishDefaults.disableStitch ?? publishDefaults.disable_stitch, true),
      disable_comment: bool(
        publishDefaults.disableComment ?? publishDefaults.disable_comment,
        false,
      ),
      is_aigc: bool(publishDefaults.isAigc ?? publishDefaults.is_aigc, true),
      brand_content_toggle: bool(
        publishDefaults.brandContentToggle ?? publishDefaults.brand_content_toggle,
        false,
      ),
      brand_organic_toggle: bool(
        publishDefaults.brandOrganicToggle ?? publishDefaults.brand_organic_toggle,
        false,
      ),
    },
    metadata: {
      draft_schedule: true,
      review_required: true,
      audio_clip_id: input.item.audio_clip_id ?? null,
      library_item_id: input.item.library_item_id ?? null,
      generation_item_id: input.item.id,
      duration_seconds: input.item.duration_seconds ?? null,
    },
  };
}

type LyricTemplateBinding = {
  id: string;
  audio_clip_id: string;
  selection_duration_ms: number | null;
};

async function resolveLyricTemplateBinding(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  raw: CreateBatchRequest,
): Promise<LyricTemplateBinding | null> {
  if (!raw.lyricTemplateId) return null;

  const tpl = await supabase
    .from("kanvas_lyric_templates")
    .select("id,status,archived_at,audio_clip_id,trimmed_audio_asset_id,selection_duration_ms")
    .eq("id", raw.lyricTemplateId)
    .maybeSingle();
  if (tpl.error) throw tpl.error;
  if (!tpl.data) throw new Error("Lyric template not found.");
  if (tpl.data.archived_at || tpl.data.status === "archived") {
    throw new Error("Lyric template is archived.");
  }
  if (tpl.data.status !== "saved") {
    throw new Error("Lyric template must be saved before generating a library.");
  }
  if (!tpl.data.trimmed_audio_asset_id) {
    throw new Error("Lyric template is missing persisted trimmed audio.");
  }
  if (!tpl.data.audio_clip_id) {
    throw new Error("Lyric template is not linked to an audio clip.");
  }
  if (raw.audioClipId && raw.audioClipId !== tpl.data.audio_clip_id) {
    throw new Error("Lyric template does not belong to the provided audio clip.");
  }

  raw.audioClipId = tpl.data.audio_clip_id;
  return {
    id: tpl.data.id,
    audio_clip_id: tpl.data.audio_clip_id,
    selection_duration_ms:
      typeof tpl.data.selection_duration_ms === "number" ? tpl.data.selection_duration_ms : null,
  };
}

function assertTemplateMatchesAudioClip(input: {
  template: LyricTemplateBinding | null;
  audioClipId: unknown;
  audioClipDurationSec: unknown;
}): void {
  if (!input.template) return;
  if (String(input.audioClipId) !== input.template.audio_clip_id) {
    throw new Error("Lyric template/audio clip mismatch.");
  }
  const templateDurationSec = Number(input.template.selection_duration_ms ?? 0) / 1000;
  const clipDurationSec = Number(input.audioClipDurationSec ?? 0);
  if (
    Number.isFinite(templateDurationSec) &&
    Number.isFinite(clipDurationSec) &&
    templateDurationSec > 0 &&
    clipDurationSec > 0 &&
    Math.abs(templateDurationSec - clipDurationSec) > 0.05
  ) {
    throw new Error("Lyric template duration does not match the audio clip duration.");
  }
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
    const raw = (await request.json()) as CreateBatchRequest;

    const lyricTemplateBinding = await resolveLyricTemplateBinding(supabase, raw);

    const input = validatePayload(raw);
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
      assertTemplateMatchesAudioClip({
        template: lyricTemplateBinding,
        audioClipId: clip.data.id,
        audioClipDurationSec: clip.data.duration_sec,
      });
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
        category_id: input.categoryId,
        subcategory_slug: input.subcategorySlug,
        randomize: input.randomize,
        auto_render: input.autoRender,
      })
      .select("*")
      .single();

    if (batch.error) throw batch.error;

    // Compute the next library_index offset for this audio clip so re-launches
    // with the same clip stack onto fresh slots instead of colliding.
    const existingMax = await supabase
      .from("video_library_items")
      .select("library_index")
      .eq("audio_clip_id", String(audioClip.id))
      .order("library_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const indexOffset =
      existingMax.data && typeof existingMax.data.library_index === "number"
        ? Number(existingMax.data.library_index) + 1
        : 0;

    const libraryRows = buildLibrarySlotRows({
      accountId: input.accountId,
      audioClipId: String(audioClip.id),
      batchId: batch.data.id,
      quantity: input.count,
      durationSec: input.durationSeconds,
      indexOffset,
    });
    const insertedLibraryItems = await supabase
      .from("video_library_items")
      .insert(libraryRows)
      .select("*");
    if (insertedLibraryItems.error) throw insertedLibraryItems.error;
    const libraryItemsByIndex = new Map(
      (insertedLibraryItems.data ?? []).map((row, idx) => [idx, row]),
    );

    const renderSchedule = input.autoRender
      ? Array.from({ length: input.count }, () => input.renderStartAt)
      : buildSchedule(input.startAt, input.count, input.cadenceMinutes);
    const draftSchedule = buildSchedule(input.startAt, input.count, input.cadenceMinutes);
    const modelId =
      input.sourceMode === "seedance" || input.sourceMode === "mixed"
        ? (optionalEnv("SEEDANCE_MODEL_ID") ?? "bytedance/seedance-2.0/fast/text-to-video")
        : input.sourceMode === "gmi_seedance"
          ? (optionalEnv("GMI_SEEDANCE_MODEL_ID") ?? "Seedance-2.0")
          : "stock-pipeline";

    const items = renderSchedule.map((scheduledAt, index) => {
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

    for (const item of insertedItems.data ?? []) {
      const libraryItemId =
        typeof item.library_item_id === "string" && item.library_item_id
          ? item.library_item_id
          : null;
      if (!libraryItemId) continue;
      const linkedLibrary = await supabase
        .from("video_library_items")
        .update({ generation_item_id: item.id, updated_at: new Date().toISOString() })
        .eq("id", libraryItemId)
        .is("generation_item_id", null);
      if (linkedLibrary.error) throw linkedLibrary.error;
    }

    let insertedPosts: Record<string, unknown>[] = [];
    if (input.autoDraftSchedule) {
      const draftRows = ((insertedItems.data ?? []) as Record<string, unknown>[]).map((item) =>
        buildDraftPostRow({
          accountId: input.accountId,
          batchId: batch.data.id,
          item,
          scheduledAt: draftSchedule[Number(item.item_index ?? 0)] ?? input.startAt,
          publishDefaults: input.publishDefaults,
        }),
      );
      const drafts = draftRows.length
        ? await supabase.from("posts").insert(draftRows).select("id,generation_item_id")
        : { data: [], error: null };
      if (drafts.error) throw drafts.error;
      insertedPosts = (drafts.data ?? []) as Record<string, unknown>[];

      for (const post of insertedPosts) {
        const generationItemId =
          typeof post.generation_item_id === "string" && post.generation_item_id
            ? post.generation_item_id
            : null;
        if (!generationItemId) continue;
        const linkedPost = await supabase
          .from("generation_items")
          .update({ post_id: post.id, updated_at: new Date().toISOString() })
          .eq("id", generationItemId)
          .is("post_id", null);
        if (linkedPost.error) throw linkedPost.error;
      }
    }

    return okEnvelope({
      batch: batch.data,
      audio_clip: audioClip,
      audio_asset: audioAsset,
      audioClip,
      audioAsset,
      video_library_items: insertedLibraryItems.data,
      items: insertedItems.data,
      posts: insertedPosts,
      items_total: insertedItems.data?.length ?? 0,
    });
  } catch (error) {
    return errorEnvelope(error, "CREATE_GENERATION_BATCH_FAILED", 500);
  }
});
