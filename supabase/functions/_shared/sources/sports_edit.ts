import { optionalEnv } from "../env.ts";
import type { AdapterSearchInput, SourceAdapter, SourceCandidate } from "./types.ts";

type SportsAdapterSettings = {
  league?: string;
  team?: string;
  allowedChannels?: string[] | string;
  publishedAfter?: string;
  maxAgeDays?: number;
};

type YouTubeSearchItem = {
  id?: { videoId?: string } | string;
};

type YouTubeVideo = {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string; width?: number; height?: number }>;
  };
  contentDetails?: {
    duration?: string;
    licensedContent?: boolean;
  };
  status?: {
    embeddable?: boolean;
    license?: string;
    privacyStatus?: string;
  };
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function parseAllowedChannels(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return unique(value);
  return unique((value ?? "").split(/[,;\n]/g));
}

function adapterSettings(input: AdapterSearchInput): SportsAdapterSettings {
  return (input.adapterSettings ?? {}) as SportsAdapterSettings;
}

export function buildSportsSearchQuery(query: string, settings: SportsAdapterSettings): string {
  return [query, settings.league, settings.team, "highlights", "vertical"]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

export function parseYouTubeDurationSeconds(duration: string | undefined): number {
  if (!duration) return 0;
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function isLikelyPortrait(video: YouTubeVideo): boolean {
  const text = `${video.snippet?.title ?? ""} ${video.snippet?.description ?? ""}`.toLowerCase();
  return /#shorts?\b|vertical|9:16|short-form/.test(text);
}

function bestThumbnail(video: YouTubeVideo): string | null {
  const thumbnails = video.snippet?.thumbnails ?? {};
  return (
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null
  );
}

export function youtubeVideoToCandidate(input: {
  video: YouTubeVideo;
  requestedChannel: string;
}): SourceCandidate {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(input.video.id)}`;
  const duration = parseYouTubeDurationSeconds(input.video.contentDetails?.duration);
  const channelTitle = input.video.snippet?.channelTitle ?? input.requestedChannel;
  const channelId = input.video.snippet?.channelId ?? input.requestedChannel;
  const license =
    input.video.status?.license === "creativeCommon"
      ? "youtube_creative_commons"
      : "youtube_standard";

  return {
    source_type: "sports_edit",
    provider: "youtube",
    external_id: input.video.id,
    origin_url: url,
    width: 1080,
    height: isLikelyPortrait(input.video) ? 1920 : 608,
    duration_seconds: duration,
    is_portrait: isLikelyPortrait(input.video),
    license,
    rights_holder: channelTitle,
    attribution: `${channelTitle} - ${url}`,
    metadata: {
      title: input.video.snippet?.title ?? null,
      channel_id: channelId,
      requested_channel: input.requestedChannel,
      published_at: input.video.snippet?.publishedAt ?? null,
      thumbnail_url: bestThumbnail(input.video),
      embeddable: input.video.status?.embeddable ?? null,
      licensed_content: input.video.contentDetails?.licensedContent ?? null,
      privacy_status: input.video.status?.privacyStatus ?? null,
      official_api: "youtube-data-api-v3",
    },
    score: isLikelyPortrait(input.video) ? 0.88 : 0.45,
  };
}

async function readJson<T>(url: URL, label: string): Promise<T> {
  const response = await fetch(url);
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${response.statusText} ${text}`.trim());
  }
  return json as T;
}

async function resolveChannelId(entry: string, apiKey: string): Promise<string | null> {
  if (/^UC[\w-]{10,}$/i.test(entry)) return entry;

  const handle = entry.startsWith("@") ? entry.slice(1) : entry;
  const byHandle = new URL("https://www.googleapis.com/youtube/v3/channels");
  byHandle.searchParams.set("part", "id");
  byHandle.searchParams.set("forHandle", handle);
  byHandle.searchParams.set("key", apiKey);
  const handleResult = await readJson<{ items?: Array<{ id?: string }> }>(
    byHandle,
    "YouTube channel handle lookup",
  );
  if (handleResult.items?.[0]?.id) return handleResult.items[0].id;

  const search = new URL("https://www.googleapis.com/youtube/v3/search");
  search.searchParams.set("part", "snippet");
  search.searchParams.set("type", "channel");
  search.searchParams.set("q", entry);
  search.searchParams.set("maxResults", "1");
  search.searchParams.set("key", apiKey);
  const searchResult = await readJson<{ items?: Array<{ id?: { channelId?: string } }> }>(
    search,
    "YouTube channel search",
  );
  return searchResult.items?.[0]?.id?.channelId ?? null;
}

function searchVideoId(item: YouTubeSearchItem): string | null {
  if (typeof item.id === "string") return item.id;
  return item.id?.videoId ?? null;
}

async function searchVideoIds(input: {
  apiKey: string;
  channelId: string;
  query: string;
  settings: SportsAdapterSettings;
  limit: number;
}): Promise<string[]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "id");
  url.searchParams.set("type", "video");
  url.searchParams.set("channelId", input.channelId);
  url.searchParams.set("q", input.query);
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("videoSyndicated", "true");
  url.searchParams.set("order", "date");
  url.searchParams.set("maxResults", String(Math.max(1, Math.min(input.limit, 50))));
  url.searchParams.set("key", input.apiKey);
  const maxAgeDays = Number(input.settings.maxAgeDays ?? 90);
  const publishedAfter =
    input.settings.publishedAfter ??
    new Date(Date.now() - Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000).toISOString();
  url.searchParams.set("publishedAfter", publishedAfter);
  const result = await readJson<{ items?: YouTubeSearchItem[] }>(url, "YouTube video search");
  return unique((result.items ?? []).map(searchVideoId).filter((id): id is string => !!id));
}

async function listVideos(apiKey: string, ids: string[]): Promise<YouTubeVideo[]> {
  if (ids.length === 0) return [];
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,contentDetails,status");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("key", apiKey);
  const result = await readJson<{ items?: YouTubeVideo[] }>(url, "YouTube video list");
  return result.items ?? [];
}

function isAllowedVideo(video: YouTubeVideo, channelId: string): boolean {
  if (video.snippet?.channelId !== channelId) return false;
  if (video.status?.privacyStatus && video.status.privacyStatus !== "public") return false;
  if (video.status?.embeddable === false) return false;
  return parseYouTubeDurationSeconds(video.contentDetails?.duration) > 0;
}

export const sportsEditAdapter: SourceAdapter = {
  type: "sports_edit",
  async search(input) {
    const apiKey = optionalEnv("YOUTUBE_API_KEY");
    const settings = adapterSettings(input);
    const allowedChannels = parseAllowedChannels([
      ...parseAllowedChannels(optionalEnv("SPORTS_EDITS_ALLOWED_CHANNELS")),
      ...parseAllowedChannels(settings.allowedChannels),
    ]);
    if (!apiKey || allowedChannels.length === 0) {
      throw new Error("sports_edit requires YOUTUBE_API_KEY and SPORTS_EDITS_ALLOWED_CHANNELS.");
    }

    const query = buildSportsSearchQuery(input.query, settings);
    const limit = input.perAdapterLimit ?? 20;
    const candidates: SourceCandidate[] = [];
    for (const channel of allowedChannels) {
      const channelId = await resolveChannelId(channel, apiKey);
      if (!channelId) continue;
      const ids = await searchVideoIds({ apiKey, channelId, query, settings, limit });
      const videos = await listVideos(apiKey, ids);
      candidates.push(
        ...videos
          .filter((video) => isAllowedVideo(video, channelId))
          .map((video) => youtubeVideoToCandidate({ video, requestedChannel: channel })),
      );
    }
    return candidates;
  },
  async cache(candidate) {
    return {
      url: candidate.cached_url ?? candidate.origin_url,
      storage_path: candidate.storage_path,
    };
  },
  describeLicense(candidate) {
    return {
      license: candidate.license,
      rights_holder: candidate.rights_holder,
      attribution: candidate.attribution,
    };
  },
};
