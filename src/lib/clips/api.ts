import { supabase } from "@/integrations/supabase/client";

export type ClipItem = {
  id: string;
  batch_id: string;
  audio_clip_id: string | null;
  status: string;
  category_id: string | null;
  created_at: string;
  scheduled_at: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  font_name: string | null;
  duration_sec: number | null;
  file_name: string;
};

export type ClipGroup = {
  audioClipId: string;
  fileName: string;
  durationSec: number | null;
  status: string;
  categoryId: string | null;
  createdAt: string;
  items: ClipItem[];
};

type Row = {
  id: string;
  batch_id: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  duration_seconds: number | null;
  final_asset_id: string | null;
  stock_clip_url: string | null;
  input_payload: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  generation_batches?: {
    id: string;
    audio_asset_id: string | null;
    status: string;
    source_mode: string;
    settings?: Record<string, unknown> | null;
  } | null;
};

type Asset = { id: string; public_url: string; file_name: string | null; metadata?: Record<string, unknown> | null };

function getCategory(row: Row): string | null {
  const payloadStock = (row.input_payload?.stock_settings ?? {}) as Record<string, unknown>;
  const batchStock = (row.generation_batches?.settings?.stock ?? {}) as Record<string, unknown>;
  return String(payloadStock.categoryId ?? payloadStock.category ?? batchStock.categoryId ?? batchStock.category ?? "") || null;
}

export async function fetchAllClips(): Promise<ClipGroup[]> {
  const { data, error } = await supabase
    .from("generation_items")
    .select(`
      id,batch_id,status,scheduled_at,created_at,duration_seconds,final_asset_id,stock_clip_url,input_payload,metadata,
      generation_batches ( id,audio_asset_id,status,source_mode,settings )
    `)
    .not("status", "eq", "archived")
    .order("created_at", { ascending: false });

  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];
  const finalAssetIds = Array.from(new Set(rows.map((row) => row.final_asset_id).filter(Boolean))) as string[];
  const audioAssetIds = Array.from(new Set(rows.map((row) => row.generation_batches?.audio_asset_id).filter(Boolean))) as string[];
  const allAssetIds = Array.from(new Set([...finalAssetIds, ...audioAssetIds]));
  const assetsById = new Map<string, Asset>();

  if (allAssetIds.length) {
    const assets = await supabase
      .from("media_assets")
      .select("id,public_url,file_name,metadata")
      .in("id", allAssetIds);
    if (assets.error) throw assets.error;
    for (const asset of (assets.data ?? []) as unknown as Asset[]) assetsById.set(asset.id, asset);
  }

  const groups = new Map<string, ClipGroup>();
  for (const row of rows) {
    const audioClipId = row.generation_batches?.audio_asset_id ?? row.batch_id;
    const finalAsset = row.final_asset_id ? assetsById.get(row.final_asset_id) : undefined;
    const audioAsset = row.generation_batches?.audio_asset_id ? assetsById.get(row.generation_batches.audio_asset_id) : undefined;
    const finalMeta = finalAsset?.metadata ?? {};
    const itemMeta = row.metadata ?? {};
    const clip: ClipItem = {
      id: row.id,
      batch_id: row.batch_id,
      audio_clip_id: audioClipId,
      status: row.status,
      category_id: getCategory(row),
      created_at: row.created_at,
      scheduled_at: row.scheduled_at,
      video_url: finalAsset?.public_url ?? row.stock_clip_url ?? null,
      thumbnail_url: typeof finalMeta.thumbnail_url === "string" ? finalMeta.thumbnail_url : null,
      font_name: String(itemMeta.lyric_font ?? finalMeta.lyric_font ?? "") || null,
      duration_sec: row.duration_seconds,
      file_name: finalAsset?.file_name ?? `${row.id}.mp4`,
    };

    const group = groups.get(audioClipId) ?? {
      audioClipId,
      fileName: audioAsset?.file_name ?? `Audio ${audioClipId.slice(0, 8)}`,
      durationSec: row.duration_seconds,
      status: row.generation_batches?.status ?? row.status,
      categoryId: clip.category_id,
      createdAt: row.created_at,
      items: [],
    };
    group.items.push(clip);
    if (row.created_at > group.createdAt) group.createdAt = row.created_at;
    groups.set(audioClipId, group);
  }

  return Array.from(groups.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

