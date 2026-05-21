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

export type StockSettings = {
  providers?: Array<"library" | "pexels" | "pixabay">;
  keywords?: string[];
  negativeKeywords?: string[];
  category?: string;
  categoryId?: string | null;
  mood?: string;
  portraitOnly?: boolean;
  minDurationSec?: number;
  maxDurationSec?: number;
  perProviderLimit?: number;
  avoidReuseWithinBatch?: boolean;
  allowReuseWhenExhausted?: boolean;
};

const DEFAULT_TARGET_DURATION = 15;

function normalizeSettings(settings?: StockSettings): Required<StockSettings> {
  const providers: Array<"library" | "pexels" | "pixabay"> = settings?.providers?.length
    ? settings.providers
    : ["library", "pexels", "pixabay"];
  return {
    providers,
    keywords: settings?.keywords ?? [],
    negativeKeywords: settings?.negativeKeywords ?? [],
    category: settings?.categoryId ?? settings?.category ?? "",
    mood: settings?.mood ?? "",
    portraitOnly: settings?.portraitOnly ?? true,
    minDurationSec: Math.max(1, Number(settings?.minDurationSec ?? DEFAULT_TARGET_DURATION - 1)),
    maxDurationSec: Math.max(1, Number(settings?.maxDurationSec ?? 120)),
    perProviderLimit: Math.max(3, Math.min(Number(settings?.perProviderLimit ?? 20), 80)),
    avoidReuseWithinBatch: settings?.avoidReuseWithinBatch ?? true,
    allowReuseWhenExhausted: settings?.allowReuseWhenExhausted ?? true,
  };
}

function buildQuery(query: string, settings: Required<StockSettings>): string {
  const terms = [query, settings.category, settings.mood, ...settings.keywords]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  let cleaned = terms || "cinematic vertical lifestyle music";
  for (const negative of settings.negativeKeywords) {
    const word = negative.trim();
    if (!word) continue;
    cleaned = cleaned.replace(
      new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"),
      "",
    );
  }
  return cleaned.replace(/\s+/g, " ").trim().slice(0, 100) || "cinematic vertical lifestyle music";
}

function aspectScore(width: number, height: number): number {
  if (!width || !height) return 0;
  const ratio = height / width;
  // Reward portrait (> 1) — perfect at 16/9 ≈ 1.777
  if (ratio >= 1) return Math.min(1, ratio / 1.777);
  // Square-ish acceptable, landscape penalised
  return Math.max(0, ratio * 0.4);
}

function rankClips(clips: StockClip[], settings: Required<StockSettings>): StockClip[] {
  const seen = new Set<string>();
  return clips
    .filter((c) => {
      if (seen.has(`${c.provider}:${c.externalId}`) || seen.has(c.url)) return false;
      seen.add(`${c.provider}:${c.externalId}`);
      seen.add(c.url);
      if (c.durationSec < settings.minDurationSec || c.durationSec > settings.maxDurationSec) {
        return false;
      }
      if (settings.portraitOnly && c.height <= c.width) return false;
      return true;
    })
    .map((c) => ({
      ...c,
      score: aspectScore(c.width, c.height) + Math.min(1, c.durationSec / 30) * 0.25,
    }))
    .sort((a, b) => b.score - a.score);
}

async function searchPexels(
  query: string,
  settings: Required<StockSettings>,
): Promise<StockClip[]> {
  const key = optionalEnv("PEXELS_API_KEY");
  if (!key) return [];
  const url = new URL("https://api.pexels.com/v1/videos/search");
  url.searchParams.set("query", query);
  if (settings.portraitOnly) url.searchParams.set("orientation", "portrait");
  url.searchParams.set("per_page", String(settings.perProviderLimit));
  url.searchParams.set("size", "medium");
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) return [];
  const data = (await res.json()) as {
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
  return (data.videos ?? [])
    .map((v) => {
      const files = v.video_files
        .filter(
          (f) => f.file_type === "video/mp4" && (!settings.portraitOnly || f.height > f.width),
        )
        .sort((a, b) => {
          const aDelta = Math.abs((a.height ?? 0) - 1280);
          const bDelta = Math.abs((b.height ?? 0) - 1280);
          if (aDelta !== bDelta) return aDelta - bDelta;
          return (a.height ?? 0) - (b.height ?? 0);
        });
      const file = files[0] ?? v.video_files.filter((f) => f.file_type === "video/mp4")[0];
      return {
        provider: "pexels" as const,
        externalId: String(v.id),
        url: file?.link ?? "",
        width: v.width,
        height: v.height,
        durationSec: v.duration,
        score: 0,
      };
    })
    .filter((c) => c.url);
}

async function searchPixabay(
  query: string,
  settings: Required<StockSettings>,
): Promise<StockClip[]> {
  const key = optionalEnv("PIXABAY_API_KEY");
  if (!key) return [];
  const url = new URL("https://pixabay.com/api/videos/");
  url.searchParams.set("key", key);
  url.searchParams.set("q", query);
  url.searchParams.set("video_type", "all");
  url.searchParams.set("per_page", String(settings.perProviderLimit));
  url.searchParams.set("safesearch", "true");
  if (settings.category) url.searchParams.set("category", settings.category);
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    hits?: Array<{
      id: number;
      duration: number;
      videos: Record<string, { url: string; width: number; height: number }>;
    }>;
  };
  return (data.hits ?? [])
    .map((v) => {
      const ordered = ["medium", "small", "tiny", "large"].map((k) => v.videos[k]).filter(Boolean);
      const variants = ordered.filter((f) => !settings.portraitOnly || f.height > f.width);
      const best = (variants.length ? variants : ordered).sort((a, b) => b.height - a.height)[0];
      return {
        provider: "pixabay" as const,
        externalId: String(v.id),
        url: best?.url ?? "",
        width: best?.width ?? 0,
        height: best?.height ?? 0,
        durationSec: Number(v.duration ?? DEFAULT_TARGET_DURATION),
        score: 0,
      };
    })
    .filter((c) => c.url);
}

async function searchLibrary(
  accountId: string,
  settings: Required<StockSettings>,
): Promise<StockClip[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("media_assets")
    .select("id,public_url,duration_seconds,metadata")
    .in("kind", ["source_video", "stock_video"])
    .eq("account_id", accountId);
  if (settings.category) {
    query = query.or(`metadata->>category_id.eq.${settings.category},metadata->>category.eq.${settings.category}`);
  }
  const res = await query.limit(settings.perProviderLimit);
  if (res.error || !res.data) return [];
  return res.data.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, number>;
    return {
      provider: "library" as const,
      externalId: row.id as string,
      url: row.public_url as string,
      width: Number(meta.width ?? 1080),
      height: Number(meta.height ?? 1920),
      durationSec: Number(row.duration_seconds ?? DEFAULT_TARGET_DURATION),
      score: 0,
    };
  });
}

export async function searchStock(input: {
  accountId: string;
  query: string;
  settings?: StockSettings;
}): Promise<StockClip[]> {
  const settings = normalizeSettings(input.settings);
  const query = buildQuery(input.query, settings);
  const searches: Array<Promise<StockClip[]>> = [];
  if (settings.providers.includes("library"))
    searches.push(searchLibrary(input.accountId, settings));
  if (settings.providers.includes("pexels")) searches.push(searchPexels(query, settings));
  if (settings.providers.includes("pixabay")) searches.push(searchPixabay(query, settings));
  const all = await Promise.all(searches).then((groups) => groups.flat());
  return rankClips(all, settings);
}

// Cache a picked stock clip into the private `stock-cache` bucket so we
// don't refetch a 50MB MP4 every render. Returns the public-ish signed URL.
export async function cacheStockClip(clip: StockClip): Promise<string> {
  if (clip.provider === "library") return clip.url;
  const supabase = getSupabaseAdmin();
  const path = `${clip.provider}/${clip.externalId}.mp4`;
  const existing = await supabase.storage
    .from("stock-cache")
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (!existing.error && existing.data?.signedUrl) {
    // HEAD check would be ideal; we trust the signed URL.
    return existing.data.signedUrl;
  }
  try {
    const dl = await fetch(clip.url);
    if (!dl.ok) throw new Error(`Stock download failed: ${dl.status}`);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    // Skip caching files larger than 45 MB — Supabase storage rejects them.
    if (bytes.byteLength > 45 * 1024 * 1024) {
      console.warn(`stock cache skip (too large: ${bytes.byteLength}B) ${clip.url}`);
      return clip.url;
    }
    const upload = await supabase.storage
      .from("stock-cache")
      .upload(path, bytes, { contentType: "video/mp4", upsert: true, cacheControl: "604800" });
    if (upload.error) throw upload.error;
    const signed = await supabase.storage
      .from("stock-cache")
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    if (signed.error || !signed.data) throw signed.error;
    return signed.data.signedUrl;
  } catch (err) {
    console.warn(
      `stock cache fallback (${err instanceof Error ? err.message : String(err)}) → using origin url`,
    );
    return clip.url;
  }
}
