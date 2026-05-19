import { optionalEnv } from "../env.ts";
import type { AdapterSearchInput, SourceAdapter, SourceCandidate } from "./types.ts";

type StreamerAdapterSettings = {
  allowedChannels?: string[] | string;
  streamer?: string;
  startedAfter?: string;
  maxAgeDays?: number;
};

type TwitchClip = {
  id: string;
  url: string;
  embed_url?: string;
  broadcaster_id?: string;
  broadcaster_name?: string;
  creator_name?: string;
  duration?: number;
  thumbnail_url?: string;
  title?: string;
  created_at?: string;
};

type TwitchUser = {
  id: string;
  login: string;
  display_name?: string;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function parseAllowedChannels(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return unique(value.map((entry) => entry.toLowerCase()));
  return unique((value ?? "").split(/[,;\n]/g).map((entry) => entry.toLowerCase()));
}

function adapterSettings(input: AdapterSearchInput): StreamerAdapterSettings {
  return (input.adapterSettings ?? {}) as StreamerAdapterSettings;
}

export function twitchMp4UrlFromThumbnail(thumbnailUrl: string | undefined): string | null {
  if (!thumbnailUrl) return null;
  const cleanUrl = thumbnailUrl.split("?")[0] ?? "";
  if (!cleanUrl.includes("clips-media-assets")) return null;
  const mp4Url = cleanUrl.replace(/-preview-\d+x\d+\.jpg$/i, ".mp4");
  return mp4Url.endsWith(".mp4") ? mp4Url : null;
}

export function twitchClipToCandidate(input: {
  clip: TwitchClip;
  requestedChannel: string;
}): SourceCandidate {
  const broadcaster = input.clip.broadcaster_name ?? input.requestedChannel;
  const duration = Number(input.clip.duration ?? 0);
  const cacheSourceUrl = twitchMp4UrlFromThumbnail(input.clip.thumbnail_url);
  return {
    source_type: "streamer_clip",
    provider: "twitch",
    external_id: input.clip.id,
    origin_url: input.clip.url,
    width: 1920,
    height: 1080,
    duration_seconds: duration,
    is_portrait: false,
    license: "twitch_creator_rights",
    rights_holder: broadcaster,
    attribution: `${broadcaster} - ${input.clip.url}`,
    metadata: {
      title: input.clip.title ?? null,
      creator_name: input.clip.creator_name ?? null,
      broadcaster_id: input.clip.broadcaster_id ?? null,
      requested_channel: input.requestedChannel,
      created_at: input.clip.created_at ?? null,
      thumbnail_url: input.clip.thumbnail_url ?? null,
      cache_source_url: cacheSourceUrl,
      embed_url: input.clip.embed_url ?? null,
      official_api: "twitch-helix",
    },
    score: duration > 0 ? 0.58 : 0.2,
  };
}

async function readJson<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${response.statusText} ${text}`.trim());
  }
  return json as T;
}

async function getTwitchAppToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const json = await readJson<{ access_token?: string }>(response, "Twitch app token");
  if (!json.access_token) throw new Error("Twitch token response missing access_token.");
  return json.access_token;
}

async function helix<T>(path: string, token: string, clientId: string, params: URLSearchParams) {
  const url = new URL(`https://api.twitch.tv/helix/${path}`);
  params.forEach((value, key) => url.searchParams.append(key, value));
  return readJson<T>(
    await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": clientId,
      },
    }),
    `Twitch Helix ${path}`,
  );
}

async function resolveUsers(input: {
  channels: string[];
  token: string;
  clientId: string;
}): Promise<TwitchUser[]> {
  const params = new URLSearchParams();
  for (const channel of input.channels) params.append("login", channel.replace(/^@/, ""));
  const result = await helix<{ data?: TwitchUser[] }>(
    "users",
    input.token,
    input.clientId,
    params,
  );
  return result.data ?? [];
}

async function listClips(input: {
  broadcasterId: string;
  token: string;
  clientId: string;
  settings: StreamerAdapterSettings;
  limit: number;
}): Promise<TwitchClip[]> {
  const params = new URLSearchParams();
  params.set("broadcaster_id", input.broadcasterId);
  params.set("first", String(Math.max(1, Math.min(input.limit, 100))));
  const maxAgeDays = Number(input.settings.maxAgeDays ?? 30);
  params.set(
    "started_at",
    input.settings.startedAfter ??
      new Date(Date.now() - Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000).toISOString(),
  );
  const result = await helix<{ data?: TwitchClip[] }>(
    "clips",
    input.token,
    input.clientId,
    params,
  );
  return result.data ?? [];
}

function requestedChannels(input: AdapterSearchInput): string[] {
  const settings = adapterSettings(input);
  const envAllowed = parseAllowedChannels(optionalEnv("STREAMER_CLIP_ALLOWED_CHANNELS"));
  const configured = parseAllowedChannels(settings.allowedChannels);
  const allowed = configured.length > 0 ? configured : envAllowed;
  const requested = parseAllowedChannels(settings.streamer);
  if (requested.length === 0) return allowed;
  return requested.filter((channel) => allowed.includes(channel));
}

async function signedStockCacheUrl(storagePath: string): Promise<string> {
  const { getSupabaseAdmin } = await import("../supabase.ts");
  const supabase = getSupabaseAdmin();
  const signed = await supabase.storage
    .from("stock-cache")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
  if (signed.error || !signed.data?.signedUrl) {
    throw signed.error ?? new Error("Could not create signed stock-cache URL.");
  }
  return signed.data.signedUrl;
}

async function cacheTwitchClip(candidate: SourceCandidate): Promise<{
  url: string;
  storage_path: string;
}> {
  if (candidate.storage_path) {
    return {
      url: candidate.cached_url ?? (await signedStockCacheUrl(candidate.storage_path)),
      storage_path: candidate.storage_path,
    };
  }

  const sourceUrl =
    typeof candidate.metadata?.cache_source_url === "string"
      ? candidate.metadata.cache_source_url
      : twitchMp4UrlFromThumbnail(
          typeof candidate.metadata?.thumbnail_url === "string"
            ? candidate.metadata.thumbnail_url
            : undefined,
        );
  if (!sourceUrl) {
    throw new Error("streamer_clip candidates require a cacheable Twitch clip MP4 URL.");
  }

  const externalId = candidate.external_id ?? candidate.id ?? crypto.randomUUID();
  const storagePath = `twitch/${String(externalId).replace(/[^\w.-]/g, "_")}.mp4`;
  const { downloadBytes } = await import("../assets.ts");
  const bytes = await downloadBytes(sourceUrl);
  if (bytes.bytes.byteLength > 190 * 1024 * 1024) {
    throw new Error("Twitch clip exceeds the stock-cache 200MB storage limit.");
  }

  const { getSupabaseAdmin } = await import("../supabase.ts");
  const supabase = getSupabaseAdmin();
  const upload = await supabase.storage.from("stock-cache").upload(storagePath, bytes.bytes, {
    contentType: bytes.mimeType === "application/octet-stream" ? "video/mp4" : bytes.mimeType,
    cacheControl: "604800",
    upsert: true,
  });
  if (upload.error) throw upload.error;

  const cachedUrl = await signedStockCacheUrl(storagePath);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (candidate.id) {
    const updated = await supabase
      .from("source_candidates")
      .update({
        cached_url: cachedUrl,
        storage_bucket: "stock-cache",
        storage_path: storagePath,
        expires_at: expiresAt,
        metadata: {
          ...(candidate.metadata ?? {}),
          cache_source_url: sourceUrl,
          cached_at: new Date().toISOString(),
        },
      })
      .eq("id", candidate.id);
    if (updated.error) throw updated.error;
  }

  return { url: cachedUrl, storage_path: storagePath };
}

export const streamerClipAdapter: SourceAdapter = {
  type: "streamer_clip",
  async search(input) {
    const clientId = optionalEnv("TWITCH_CLIENT_ID");
    const clientSecret = optionalEnv("TWITCH_CLIENT_SECRET");
    const channels = requestedChannels(input);
    if (!clientId || !clientSecret || channels.length === 0) {
      throw new Error(
        "streamer_clip requires TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and STREAMER_CLIP_ALLOWED_CHANNELS.",
      );
    }

    const token = await getTwitchAppToken(clientId, clientSecret);
    const users = await resolveUsers({ channels, token, clientId });
    const settings = adapterSettings(input);
    const candidates: SourceCandidate[] = [];
    for (const user of users) {
      const clips = await listClips({
        broadcasterId: user.id,
        token,
        clientId,
        settings,
        limit: input.perAdapterLimit ?? 20,
      });
      candidates.push(
        ...clips.map((clip) =>
          twitchClipToCandidate({ clip, requestedChannel: user.display_name ?? user.login }),
        ),
      );
    }
    return candidates;
  },
  async cache(candidate) {
    return cacheTwitchClip(candidate);
  },
  describeLicense(candidate) {
    return {
      license: candidate.license,
      rights_holder: candidate.rights_holder,
      attribution: candidate.attribution,
    };
  },
};
