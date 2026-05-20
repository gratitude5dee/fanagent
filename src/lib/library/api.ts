import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionData } from "@/lib/studio/envelope";
import type { AudioClip, LibraryItem, MediaAsset, SourceCandidate } from "./types";

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

function coerceLibraryItem(
  row: Record<string, unknown>,
  media?: MediaAsset | null,
  nextScheduledAt?: string | null,
): LibraryItem {
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
    next_scheduled_at:
      nextScheduledAt ?? (typeof row.next_scheduled_at === "string" ? row.next_scheduled_at : null),
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
    const counts = rows.reduce<{
      ready: number;
      failed: number;
      scheduled: number;
      blocked: number;
    }>(
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
  const itemIds = itemRows.map((row) => String(row.id));
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
  const nextScheduledByItemId = new Map<string, string>();
  if (itemIds.length > 0) {
    const postRows = await supabase
      .from("posts")
      .select("library_item_id,scheduled_at,status")
      .in("library_item_id", itemIds)
      .neq("status", "skipped")
      .order("scheduled_at", { ascending: true });
    if (postRows.error) throw postRows.error;
    for (const post of (postRows.data ?? []) as Record<string, unknown>[]) {
      const libraryItemId = String(post.library_item_id ?? "");
      if (!libraryItemId || nextScheduledByItemId.has(libraryItemId)) continue;
      const scheduledAt = typeof post.scheduled_at === "string" ? post.scheduled_at : null;
      if (scheduledAt) nextScheduledByItemId.set(libraryItemId, scheduledAt);
    }
  }

  return {
    clip: coerceAudioClip(clip.data as Record<string, unknown>),
    items: itemRows.map((row) =>
      coerceLibraryItem(
        row,
        typeof row.final_asset_id === "string" ? mediaById.get(row.final_asset_id) : null,
        nextScheduledByItemId.get(String(row.id)) ?? null,
      ),
    ),
  };
}

export async function listReadyLibraryItems(limit = 50): Promise<LibraryItem[]> {
  // Fetch a wider window so we can exclude items that already have an
  // active post row (status != 'skipped') and still return ~limit results.
  const fetchLimit = Math.min(limit * 3, 250);
  const items = await supabase
    .from("video_library_items")
    .select("*")
    .eq("status", "ready")
    .order("updated_at", { ascending: false })
    .limit(fetchLimit);
  if (items.error) throw items.error;

  const itemRows = (items.data ?? []) as Record<string, unknown>[];
  const libraryIds = itemRows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  // A library item is only "available in the Ready lane" if it has no
  // active post. Skipped/recovered posts don't count.
  const claimedIds = new Set<string>();
  if (libraryIds.length > 0) {
    const linkedPosts = await supabase
      .from("posts")
      .select("library_item_id,status")
      .in("library_item_id", libraryIds)
      .neq("status", "skipped");
    if (linkedPosts.error) throw linkedPosts.error;
    for (const row of (linkedPosts.data ?? []) as Record<string, unknown>[]) {
      const id = typeof row.library_item_id === "string" ? row.library_item_id : null;
      if (id) claimedIds.add(id);
    }
  }

  const availableRows = itemRows
    .filter((row) => typeof row.id === "string" && !claimedIds.has(row.id as string))
    .slice(0, limit);

  const assetIds = Array.from(
    new Set(
      availableRows
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

  return availableRows.map((row) =>
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

export async function markLibraryItemUnfit(libraryItemId: string, reason?: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("fanpage-campaign", {
    body: {
      action: "markLibraryItemUnfit",
      libraryItemId,
      reason,
    },
  });
  if (error) {
    if (data) unwrapFunctionData(data);
    throw new Error(error.message);
  }
  unwrapFunctionData(data);
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
  libraryItemId: string;
  audioClipId: string;
  accountId: string;
  segmentIndex: number;
  sourceType: string;
  query: string;
  targetDurationSec: number;
}): Promise<SourceCandidate[]> {
  const { data, error } = await supabase.functions.invoke("source-candidate-replace", {
    body: {
      action: "searchCandidates",
      libraryItemId: input.libraryItemId,
      audioClipId: input.audioClipId,
      accountId: input.accountId,
      portraitOnly: true,
      segmentIndex: input.segmentIndex,
      sourceType: input.sourceType,
      query: input.query,
      targetDurationSec: input.targetDurationSec,
      settings: { perAdapterLimit: 12 },
    },
  });
  if (error) {
    if (data) return unwrapFunctionData(data);
    throw new Error(error.message);
  }
  const result = unwrapFunctionData<{ candidates: SourceCandidate[] }>(data);
  return result.candidates ?? [];
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
