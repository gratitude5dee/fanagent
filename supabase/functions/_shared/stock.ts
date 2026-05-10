// Stock footage provider layer for Fanpage Autopilot.
// Searches Pexels Videos, Pixabay Videos, and the user's media_assets library.
// Picks a single best vertical-friendly clip ≥ targetDuration and caches it
// into the private `stock-cache` bucket so repeat picks skip the network.

import { optionalEnv } from "./env.ts";
import { getSupabaseAdmin } from "./supabase.ts";

export type StockClip = {
  provider: "library" | "pexels" | "pixabay";
  externalId: string;
  url: string;
  width: number;
  height: number;
  durationSec: number;
  score: number;
};

const TARGET_DURATION = 15;

function aspectScore(width: number, height: number): number {
  if (!width || !height) return 0;
  const ratio = height / width;
  // Reward portrait (> 1) — perfect at 16/9 ≈ 1.777
  if (ratio >= 1) return Math.min(1, ratio / 1.777);
  // Square-ish acceptable, landscape penalised
  return Math.max(0, ratio * 0.4);
}

function rankClips(clips: StockClip[]): StockClip[] {
  return clips
    .filter((c) => c.durationSec >= TARGET_DURATION - 1)
    .map((c) => ({
      ...c,
      score: aspectScore(c.width, c.height) +
        Math.min(1, c.durationSec / 30) * 0.25,
    }))
    .sort((a, b) => b.score - a.score);
}

async function searchPexels(query: string): Promise<StockClip[]> {
  const key = optionalEnv("PEXELS_API_KEY");
  if (!key) return [];
  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("per_page", "15");
  url.searchParams.set("size", "medium");
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) return [];
  const data = await res.json() as {
    videos?: Array<{
      id: number;
      duration: number;
      width: number;
      height: number;
      video_files: Array<{
        link: string;
        width: number;
        height: number;
        quality: string;
        file_type: string;
      }>;
    }>;
  };
  return (data.videos ?? []).map((v) => {
    const file = v.video_files
      .filter((f) => f.file_type === "video/mp4")
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
    return {
      provider: "pexels" as const,
      externalId: String(v.id),
      url: file?.link ?? "",
      width: v.width,
      height: v.height,
      durationSec: v.duration,
      score: 0,
    };
  }).filter((c) => c.url);
}

async function searchPixabay(query: string): Promise<StockClip[]> {
  const key = optionalEnv("PIXABAY_API_KEY");
  if (!key) return [];
  const url = new URL("https://pixabay.com/api/videos/");
  url.searchParams.set("key", key);
  url.searchParams.set("q", query);
  url.searchParams.set("video_type", "all");
  url.searchParams.set("per_page", "20");
  url.searchParams.set("safesearch", "true");
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json() as {
    hits?: Array<{
      id: number;
      duration: number;
      videos: Record<string, { url: string; width: number; height: number }>;
    }>;
  };
  return (data.hits ?? []).map((v) => {
    const variants = ["large", "medium", "small", "tiny"]
      .map((k) => v.videos[k]).filter(Boolean);
    const best = variants.sort((a, b) => b.height - a.height)[0];
    return {
      provider: "pixabay" as const,
      externalId: String(v.id),
      url: best?.url ?? "",
      width: best?.width ?? 0,
      height: best?.height ?? 0,
      durationSec: v.duration,
      score: 0,
    };
  }).filter((c) => c.url);
}

async function searchLibrary(accountId: string): Promise<StockClip[]> {
  const supabase = getSupabaseAdmin();
  const res = await supabase
    .from("media_assets")
    .select("id,public_url,duration_seconds,metadata")
    .in("kind", ["source_video", "stock_video"])
    .eq("account_id", accountId)
    .limit(20);
  if (res.error || !res.data) return [];
  return res.data.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, number>;
    return {
      provider: "library" as const,
      externalId: row.id as string,
      url: row.public_url as string,
      width: Number(meta.width ?? 1080),
      height: Number(meta.height ?? 1920),
      durationSec: Number(row.duration_seconds ?? TARGET_DURATION),
      score: 0,
    };
  });
}

export async function searchStock(input: {
  accountId: string;
  query: string;
}): Promise<StockClip[]> {
  const all = await Promise.all([
    searchLibrary(input.accountId),
    searchPexels(input.query),
    searchPixabay(input.query),
  ]).then((groups) => groups.flat());
  return rankClips(all);
}

// Cache a picked stock clip into the private `stock-cache` bucket so we
// don't refetch a 50MB MP4 every render. Returns the public-ish signed URL.
export async function cacheStockClip(clip: StockClip): Promise<string> {
  if (clip.provider === "library") return clip.url;
  const supabase = getSupabaseAdmin();
  const path = `${clip.provider}/${clip.externalId}.mp4`;
  const existing = await supabase.storage.from("stock-cache").createSignedUrl(
    path,
    60 * 60 * 24 * 7,
  );
  if (!existing.error && existing.data?.signedUrl) {
    // HEAD check would be ideal; we trust the signed URL.
    return existing.data.signedUrl;
  }
  const dl = await fetch(clip.url);
  if (!dl.ok) throw new Error(`Stock download failed: ${dl.status}`);
  const bytes = new Uint8Array(await dl.arrayBuffer());
  const upload = await supabase.storage.from("stock-cache").upload(
    path,
    bytes,
    { contentType: "video/mp4", upsert: true, cacheControl: "604800" },
  );
  if (upload.error) throw upload.error;
  const signed = await supabase.storage.from("stock-cache").createSignedUrl(
    path,
    60 * 60 * 24 * 7,
  );
  if (signed.error || !signed.data) throw signed.error;
  return signed.data.signedUrl;
}
