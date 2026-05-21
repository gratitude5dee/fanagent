// Grouped view of every rendered video in the workspace. Backs /clips.
//
// Source of truth: video_library_items, joined with audio_clips for the
// group header and with media_assets for playback. We avoid hitting the
// fanpage-campaign edge function — this page is intentionally read-only and
// realtime-friendly.

import { supabase } from "@/integrations/supabase/client";
import type { AudioClip, LibraryItem, MediaAsset } from "@/lib/library/types";

function metadataValue(value: unknown): Record<string, unknown> {
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
    metadata: metadataValue(row.metadata),
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
    metadata: metadataValue(row.metadata),
  };
}

function coerceLibraryItem(
  row: Record<string, unknown>,
  media: MediaAsset | null,
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
    reused_flags: metadataValue(row.reused_flags),
    default_caption: typeof row.default_caption === "string" ? row.default_caption : null,
    default_hashtags: arrayValue<string>(row.default_hashtags),
    metadata: metadataValue(row.metadata),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    media,
  };
}

export type ClipGroup = {
  audioClip: AudioClip;
  items: LibraryItem[];
  latestUpdatedAt: string;
};

export async function fetchAllClipGroups(): Promise<ClipGroup[]> {
  const items = await supabase
    .from("video_library_items")
    .select("*")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(500);
  if (items.error) throw items.error;
  const itemRows = (items.data ?? []) as Record<string, unknown>[];
  if (itemRows.length === 0) return [];

  const audioClipIds = Array.from(
    new Set(itemRows.map((row) => String(row.audio_clip_id ?? "")).filter(Boolean)),
  );
  const assetIds = Array.from(
    new Set(
      itemRows
        .map((row) => row.final_asset_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const [clipsRes, mediaRes] = await Promise.all([
    audioClipIds.length > 0
      ? supabase.from("audio_clips").select("*").in("id", audioClipIds)
      : Promise.resolve({ data: [], error: null } as const),
    assetIds.length > 0
      ? supabase
          .from("media_assets")
          .select("id,kind,source,public_url,mime_type,storage_bucket,storage_path,metadata")
          .in("id", assetIds)
      : Promise.resolve({ data: [], error: null } as const),
  ]);
  if (clipsRes.error) throw clipsRes.error;
  if (mediaRes.error) throw mediaRes.error;

  const clipById = new Map<string, AudioClip>();
  for (const row of (clipsRes.data ?? []) as Record<string, unknown>[]) {
    const clip = coerceAudioClip(row);
    clipById.set(clip.id, clip);
  }
  const mediaById = new Map<string, MediaAsset>();
  for (const row of (mediaRes.data ?? []) as Record<string, unknown>[]) {
    const asset = coerceMediaAsset(row);
    mediaById.set(asset.id, asset);
  }

  const groups = new Map<string, ClipGroup>();
  for (const row of itemRows) {
    const audioClipId = String(row.audio_clip_id ?? "");
    if (!audioClipId) continue;
    const audioClip = clipById.get(audioClipId);
    if (!audioClip) continue;
    const media =
      typeof row.final_asset_id === "string" ? (mediaById.get(row.final_asset_id) ?? null) : null;
    const item = coerceLibraryItem(row, media);
    const existing = groups.get(audioClipId);
    if (existing) {
      existing.items.push(item);
      if (item.updated_at > existing.latestUpdatedAt) {
        existing.latestUpdatedAt = item.updated_at;
      }
    } else {
      groups.set(audioClipId, {
        audioClip,
        items: [item],
        latestUpdatedAt: item.updated_at,
      });
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => a.library_index - b.library_index),
    }))
    .sort((a, b) => (a.latestUpdatedAt < b.latestUpdatedAt ? 1 : -1));
}
