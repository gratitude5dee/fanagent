import { supabase } from "@/integrations/supabase/client";
import type { AudioClip, LibraryItem, MediaAsset, SourceCandidate } from "./types";

type FunctionEnvelope<T> = {
  success: boolean;
  code?: string;
  message?: string;
  data: T | null;
  error?: string | null;
};

export type AudioClipSummary = {
  clip: AudioClip;
  total: number;
  ready: number;
  failed: number;
  scheduled: number;
  blocked: number;
  thumbnailUrl: string | null;
  updatedAt: string;
};

export type LibraryDetail = {
  clip: AudioClip;
  items: LibraryItem[];
};

export type ScheduleRequestItem = {
  libraryItemId: string;
  scheduledAt: string;
  caption?: string;
  hashtags?: string[];
  tiktokOptions?: Record<string, unknown>;
};

export type BulkScheduleRequest = {
  libraryItemIds: string[];
  rule: Record<string, unknown>;
  captionTemplate?: string;
  hashtags?: string[];
  tiktokOptions?: Record<string, unknown>;
};

function unwrapFunctionData<T>(value: unknown): T {
  if (typeof value !== "object" || value === null || !("success" in value)) return value as T;
  const envelope = value as FunctionEnvelope<T>;
  if (envelope.success) return envelope.data as T;
  throw new Error(envelope.error || envelope.message || envelope.code || "Function failed");
}

function metadata(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function coerceAudioClip(row: Record<string, unknown>): AudioClip {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    source_asset_id: String(row.source_asset_id),
    trimmed_asset_id: typeof row.trimmed_asset_id === "string" ? row.trimmed_asset_id : null,
    selection_start_sec: Number(row.selection_start_sec ?? 0),
    selection_end_sec: Number(row.selection_end_sec ?? 0),
    duration_sec: Number(row.duration_sec ?? 0),
    file_name: typeof row.file_name === "string" ? row.file_name : null,
    perceptual_hash: typeof row.perceptual_hash === "string" ? row.perceptual_hash : null,
    transcription_status: String(row.transcription_status ?? "pending"),
    default_lyric_template_id:
      typeof row.default_lyric_template_id === "string" ? row.default_lyric_template_id : null,
    metadata: metadata(row.metadata),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function coerceMediaAsset(row: Record<string, unknown>): MediaAsset {
  return {
    id: String(row.id),
    kind: typeof row.kind === "string" ? row.kind : null,
    source: typeof row.source === "string" ? row.source : null,
    public_url: typeof row.public_url === "string" ? row.public_url : null,
    mime_type: typeof row.mime_type === "string" ? row.mime_type : null,
    storage_bucket: typeof row.storage_bucket === "string" ? row.storage_bucket : null,
    storage_path: typeof row.storage_path === "string" ? row.storage_path : null,
    metadata: metadata(row.metadata),
  };
}

function coerceLibraryItem(row: Record<string, unknown>, media?: MediaAsset | null): LibraryItem {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    audio_clip_id: String(row.audio_clip_id),
    batch_id: typeof row.batch_id === "string" ? row.batch_id : null,
    generation_item_id: typeof row.generation_item_id === "string" ? row.generation_item_id : null,
    library_index: Number(row.library_index ?? 0),
    status: String(row.status ?? "not_ready") as LibraryItem["status"],
    final_asset_id: typeof row.final_asset_id === "string" ? row.final_asset_id : null,
    thumbnail_url: typeof row.thumbnail_url === "string" ? row.thumbnail_url : null,
    duration_sec: Number(row.duration_sec ?? 0),
    segments: arrayValue(row.segments),
    provenance: arrayValue(row.provenance),
    perceptual_hash: typeof row.perceptual_hash === "string" ? row.perceptual_hash : null,
    reused_flags: metadata(row.reused_flags),
    default_caption: typeof row.default_caption === "string" ? row.default_caption : null,
    default_hashtags: arrayValue<string>(row.default_hashtags),
    metadata: metadata(row.metadata),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    media,
  };
}

export async function listAudioClips(): Promise<AudioClipSummary[]> {
  const clips = await supabase
    .from("audio_clips")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (clips.error) throw clips.error;

  const clipRows = (clips.data ?? []) as Record<string, unknown>[];
  if (clipRows.length === 0) return [];

  const clipIds = clipRows.map((row) => String(row.id));
  const items = await supabase
    .from("video_library_items")
    .select("id,audio_clip_id,status,thumbnail_url,updated_at")
    .in("audio_clip_id", clipIds);
  if (items.error) throw items.error;

  const byClip = new Map<string, Record<string, unknown>[]>();
  for (const row of (items.data ?? []) as Record<string, unknown>[]) {
    const clipId = String(row.audio_clip_id);
    byClip.set(clipId, [...(byClip.get(clipId) ?? []), row]);
  }

  return clipRows.map((row) => {
    const clip = coerceAudioClip(row);
    const rows = byClip.get(clip.id) ?? [];
    const counts = rows.reduce(
      (acc, item) => {
        const status = String(item.status ?? "not_ready");
        if (status === "ready") acc.ready += 1;
        if (status === "failed") acc.failed += 1;
        if (status === "scheduled") acc.scheduled += 1;
        if (status === "blocked") acc.blocked += 1;
        return acc;
      },
      { ready: 0, failed: 0, scheduled: 0, blocked: 0 },
    );
    return {
      clip,
      total: rows.length,
      ...counts,
      thumbnailUrl:
        rows.find((item) => typeof item.thumbnail_url === "string")?.thumbnail_url?.toString() ??
        null,
      updatedAt:
        rows
          .map((item) => String(item.updated_at ?? ""))
          .filter(Boolean)
          .sort()
          .at(-1) ?? clip.updated_at,
    };
  });
}

export async function getLibraryDetail(audioClipId: string): Promise<LibraryDetail> {
  const clip = await supabase.from("audio_clips").select("*").eq("id", audioClipId).single();
  if (clip.error) throw clip.error;

  const items = await supabase
    .from("video_library_items")
    .select("*")
    .eq("audio_clip_id", audioClipId)
    .order("library_index", { ascending: true });
  if (items.error) throw items.error;

  const itemRows = (items.data ?? []) as Record<string, unknown>[];
  const assetIds = Array.from(
    new Set(
      itemRows
        .map((row) => row.final_asset_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const mediaById = new Map<string, MediaAsset>();
  if (assetIds.length > 0) {
    const media = await supabase
      .from("media_assets")
      .select("id,kind,source,public_url,mime_type,storage_bucket,storage_path,metadata")
      .in("id", assetIds);
    if (media.error) throw media.error;
    for (const row of (media.data ?? []) as Record<string, unknown>[]) {
      const asset = coerceMediaAsset(row);
      mediaById.set(asset.id, asset);
    }
  }

  return {
    clip: coerceAudioClip(clip.data as Record<string, unknown>),
    items: itemRows.map((row) =>
      coerceLibraryItem(
        row,
        typeof row.final_asset_id === "string" ? mediaById.get(row.final_asset_id) : null,
      ),
    ),
  };
}

export async function listReadyLibraryItems(limit = 50): Promise<LibraryItem[]> {
  const items = await supabase
    .from("video_library_items")
    .select("*")
    .eq("status", "ready")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (items.error) throw items.error;

  const itemRows = (items.data ?? []) as Record<string, unknown>[];
  const assetIds = Array.from(
    new Set(
      itemRows
        .map((row) => row.final_asset_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const mediaById = new Map<string, MediaAsset>();
  if (assetIds.length > 0) {
    const media = await supabase
      .from("media_assets")
      .select("id,kind,source,public_url,mime_type,storage_bucket,storage_path,metadata")
      .in("id", assetIds);
    if (media.error) throw media.error;
    for (const row of (media.data ?? []) as Record<string, unknown>[]) {
      const asset = coerceMediaAsset(row);
      mediaById.set(asset.id, asset);
    }
  }

  return itemRows.map((row) =>
    coerceLibraryItem(
      row,
      typeof row.final_asset_id === "string" ? mediaById.get(row.final_asset_id) : null,
    ),
  );
}

export async function regenerateGenerationItems(generationItemIds: string[]): Promise<void> {
  for (const itemId of generationItemIds) {
    const { data, error } = await supabase.functions.invoke("fanpage-campaign", {
      body: { action: "regenerate", itemId },
    });
    if (error) {
      if (data) unwrapFunctionData(data);
      throw new Error(error.message);
    }
    unwrapFunctionData(data);
  }
}

export async function scheduleLibraryItems(items: ScheduleRequestItem[]): Promise<void> {
  const { data, error } = await supabase.functions.invoke("library-schedule", {
    body: { items },
  });
  if (error) {
    if (data) unwrapFunctionData(data);
    throw new Error(error.message);
  }
  unwrapFunctionData(data);
}

export async function bulkScheduleLibraryItems(input: BulkScheduleRequest): Promise<void> {
  const { data, error } = await supabase.functions.invoke("library-bulk-schedule", {
    body: input,
  });
  if (error) {
    if (data) unwrapFunctionData(data);
    throw new Error(error.message);
  }
  unwrapFunctionData(data);
}

export async function searchReplacementCandidates(input: {
  audioClipId: string;
  accountId: string;
  segmentIndex: number;
  sourceType: string;
  query: string;
  targetDurationSec: number;
}): Promise<SourceCandidate[]> {
  const { data, error } = await supabase.functions.invoke("source-candidate-search", {
    body: {
      audioClipId: input.audioClipId,
      accountId: input.accountId,
      portraitOnly: true,
      segments: [
        {
          segmentIndex: input.segmentIndex,
          sourceType: input.sourceType,
          query: input.query,
          targetDurationSec: input.targetDurationSec,
          settings: { perAdapterLimit: 12 },
        },
      ],
    },
  });
  if (error) {
    if (data) return unwrapFunctionData(data);
    throw new Error(error.message);
  }
  const result = unwrapFunctionData<{ candidates: Record<string, SourceCandidate[]> }>(data);
  return result.candidates[String(input.segmentIndex)] ?? [];
}

export async function replaceLibrarySegment(input: {
  libraryItemId: string;
  segmentIndex: number;
  candidateId: string;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke("source-candidate-replace", {
    body: input,
  });
  if (error) {
    if (data) unwrapFunctionData(data);
    throw new Error(error.message);
  }
  unwrapFunctionData(data);
}
