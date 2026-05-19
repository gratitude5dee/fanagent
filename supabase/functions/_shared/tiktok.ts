import { decryptSecret, encryptSecret } from "./crypto.ts";
import { requireEnv } from "./env.ts";

const apiBase = "https://open.tiktokapis.com";
const authBase = "https://www.tiktok.com/v2/auth/authorize/";

export type TikTokPublishBlockStatus =
  | "blocked_account_not_connected"
  | "blocked_missing_privacy"
  | "blocked_creator_restriction"
  | "blocked_missing_video";

export type TikTokPublishErrorClassification =
  | {
      kind: "blocked";
      publishStatus: TikTokPublishBlockStatus;
      message: string;
    }
  | {
      kind: "retryable";
      message: string;
    }
  | {
      kind: "failed";
      message: string;
    };

export class TikTokPublishBlockedError extends Error {
  publishStatus: TikTokPublishBlockStatus;

  constructor(message: string, publishStatus: TikTokPublishBlockStatus) {
    super(message);
    this.name = "TikTokPublishBlockedError";
    this.publishStatus = publishStatus;
  }
}

export type TikTokPostSettings = {
  title: string;
  privacyLevel: string;
  disableDuet: boolean;
  disableComment: boolean;
  disableStitch: boolean;
  isAigc: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
};

type TikTokPublishPreflightPost = {
  video_url?: string | null;
  tiktok_privacy_level?: string | null;
};

async function getSupabase() {
  const { getSupabaseAdmin } = await import("./supabase.ts");
  return getSupabaseAdmin();
}

export function isBlockedPublishStatus(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("blocked_");
}

export function getTikTokPublishBlock(
  post: TikTokPublishPreflightPost,
): { publishStatus: TikTokPublishBlockStatus; message: string } | null {
  if (!post.video_url) {
    return {
      publishStatus: "blocked_missing_video",
      message: "Post is missing a final video URL.",
    };
  }
  if (!post.tiktok_privacy_level) {
    return {
      publishStatus: "blocked_missing_privacy",
      message: "Choose a TikTok privacy level before publishing.",
    };
  }
  return null;
}

export function isRetryableTikTokPublishError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|500|502|503|504|rate_limit|internal_error)\b/i.test(message);
}

export function nextTikTokRetryDelayMinutes(currentRetryCount: number | null | undefined): number {
  const retryCount = Number.isFinite(currentRetryCount) ? Number(currentRetryCount) : 0;
  return Math.min(240, 5 * 2 ** Math.max(0, retryCount));
}

export function classifyTikTokPublishError(error: unknown): TikTokPublishErrorClassification {
  if (error instanceof TikTokPublishBlockedError) {
    return {
      kind: "blocked",
      publishStatus: error.publishStatus,
      message: error.message,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/TikTok account is not connected/i.test(message)) {
    return {
      kind: "blocked",
      publishStatus: "blocked_account_not_connected",
      message: "Connect TikTok to auto-post.",
    };
  }

  if (isRetryableTikTokPublishError(error)) {
    return {
      kind: "retryable",
      message,
    };
  }

  return {
    kind: "failed",
    message,
  };
}

export function ensureCreatorAllowsPost(
  creatorInfo: Record<string, unknown>,
  post: TikTokPublishPreflightPost & {
    tiktok_disable_duet?: boolean;
    tiktok_disable_stitch?: boolean;
    tiktok_disable_comment?: boolean;
  },
) {
  const options = Array.isArray(creatorInfo.privacy_level_options)
    ? creatorInfo.privacy_level_options.map(String)
    : [];
  if (!post.tiktok_privacy_level) {
    throw new TikTokPublishBlockedError(
      "Choose a TikTok privacy level before publishing.",
      "blocked_missing_privacy",
    );
  }
  if (options.length > 0 && !options.includes(post.tiktok_privacy_level)) {
    throw new TikTokPublishBlockedError(
      "Selected TikTok privacy level is not available for this creator.",
      "blocked_creator_restriction",
    );
  }
  if (creatorInfo.duet_disabled === true && !post.tiktok_disable_duet) {
    throw new TikTokPublishBlockedError(
      "TikTok creator settings require duet to be disabled.",
      "blocked_creator_restriction",
    );
  }
  if (creatorInfo.stitch_disabled === true && !post.tiktok_disable_stitch) {
    throw new TikTokPublishBlockedError(
      "TikTok creator settings require stitch to be disabled.",
      "blocked_creator_restriction",
    );
  }
  if (creatorInfo.comment_disabled === true && !post.tiktok_disable_comment) {
    throw new TikTokPublishBlockedError(
      "TikTok creator settings require comments to be disabled.",
      "blocked_creator_restriction",
    );
  }
}

export function encodeOAuthState(state: { accountId: string; createdAt: number }): string {
  return btoa(JSON.stringify(state)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeOAuthState(value: string): { accountId: string; createdAt: number } {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const state = JSON.parse(atob(padded)) as {
    accountId?: string;
    createdAt?: number;
  };
  if (!state.accountId || !state.createdAt) {
    throw new Error("Invalid TikTok OAuth state.");
  }
  return { accountId: state.accountId, createdAt: state.createdAt };
}

export function buildAuthorizeUrl(accountId: string): string {
  const url = new URL(authBase);
  url.searchParams.set("client_key", requireEnv("TIKTOK_CLIENT_KEY"));
  url.searchParams.set("scope", "user.info.basic,video.publish,video.upload");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", requireEnv("TIKTOK_REDIRECT_URI"));
  url.searchParams.set("state", encodeOAuthState({ accountId, createdAt: Date.now() }));
  return url.toString();
}

async function readJson<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${response.statusText} ${text}`.trim());
  }
  if (json.error?.code && json.error.code !== "ok") {
    throw new Error(`${label} failed: ${json.error.code} ${json.error.message ?? ""}`.trim());
  }
  return json as T;
}

export async function exchangeCode(code: string) {
  return readJson<{
    access_token: string;
    refresh_token?: string;
    open_id: string;
    scope?: string;
    expires_in?: number;
  }>(
    await fetch(`${apiBase}/v2/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: requireEnv("TIKTOK_CLIENT_KEY"),
        client_secret: requireEnv("TIKTOK_CLIENT_SECRET"),
        code,
        grant_type: "authorization_code",
        redirect_uri: requireEnv("TIKTOK_REDIRECT_URI"),
      }),
    }),
    "TikTok token exchange",
  );
}

export async function saveTokens(
  accountId: string,
  tokens: {
    access_token: string;
    refresh_token?: string;
    open_id: string;
    scope?: string;
    expires_in?: number;
  },
) {
  const supabase = await getSupabase();
  const values: Record<string, unknown> = {
    tiktok_open_id: tokens.open_id,
    tiktok_access_token_encrypted: await encryptSecret(tokens.access_token),
    tiktok_token_expires_at: new Date(
      Date.now() + (tokens.expires_in ?? 86400) * 1000,
    ).toISOString(),
    tiktok_scope: tokens.scope ?? null,
    tiktok_connected_at: new Date().toISOString(),
  };

  if (tokens.refresh_token) {
    values.tiktok_refresh_token_encrypted = await encryptSecret(tokens.refresh_token);
  }

  const updated = await supabase.from("accounts").update(values).eq("id", accountId);
  if (updated.error) throw updated.error;
}

async function refreshAccessToken(
  accountId: string,
  refreshTokenEncrypted: string,
): Promise<string> {
  const refreshToken = await decryptSecret(refreshTokenEncrypted);
  const tokens = await readJson<{
    access_token: string;
    refresh_token?: string;
    open_id: string;
    scope?: string;
    expires_in?: number;
  }>(
    await fetch(`${apiBase}/v2/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: requireEnv("TIKTOK_CLIENT_KEY"),
        client_secret: requireEnv("TIKTOK_CLIENT_SECRET"),
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    }),
    "TikTok token refresh",
  );

  await saveTokens(accountId, tokens);
  return tokens.access_token;
}

export async function getAccessToken(accountId: string): Promise<string> {
  const supabase = await getSupabase();
  const account = await supabase
    .from("accounts")
    .select("tiktok_access_token_encrypted,tiktok_refresh_token_encrypted,tiktok_token_expires_at")
    .eq("id", accountId)
    .single();
  if (account.error) throw account.error;
  if (!account.data.tiktok_access_token_encrypted) {
    throw new TikTokPublishBlockedError(
      "TikTok account is not connected.",
      "blocked_account_not_connected",
    );
  }
  const expiresAt = Date.parse(account.data.tiktok_token_expires_at ?? "");
  if (Number.isFinite(expiresAt) && expiresAt < Date.now() + 5 * 60_000) {
    if (!account.data.tiktok_refresh_token_encrypted) {
      throw new Error("TikTok token expired and no refresh token is stored.");
    }
    return refreshAccessToken(accountId, account.data.tiktok_refresh_token_encrypted);
  }
  return decryptSecret(account.data.tiktok_access_token_encrypted);
}

export async function queryCreatorInfo(accessToken: string) {
  const json = await readJson<{ data?: Record<string, unknown> }>(
    await fetch(`${apiBase}/v2/post/publish/creator_info/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: "{}",
    }),
    "TikTok creator info",
  );
  return json.data ?? {};
}

export function createChunkPlan(videoSize: number): { chunkSize: number; totalChunkCount: number } {
  const chunkSize = Math.min(10 * 1024 * 1024, Math.max(videoSize, 1));
  return {
    chunkSize,
    totalChunkCount: Math.max(1, Math.ceil(videoSize / chunkSize)),
  };
}

export function buildDirectPostBody(
  settings: TikTokPostSettings,
  videoSize: number,
): Record<string, unknown> {
  const plan = createChunkPlan(videoSize);
  return {
    post_info: {
      title: settings.title,
      privacy_level: settings.privacyLevel,
      disable_duet: settings.disableDuet,
      disable_comment: settings.disableComment,
      disable_stitch: settings.disableStitch,
      brand_content_toggle: settings.brandContentToggle,
      brand_organic_toggle: settings.brandOrganicToggle,
      is_aigc: settings.isAigc,
      video_cover_timestamp_ms: 1000,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: plan.chunkSize,
      total_chunk_count: plan.totalChunkCount,
    },
  };
}

export async function initDirectPost(
  accessToken: string,
  settings: TikTokPostSettings,
  videoSize: number,
) {
  const json = await readJson<{ data?: { publish_id: string; upload_url: string } }>(
    await fetch(`${apiBase}/v2/post/publish/video/init/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(buildDirectPostBody(settings, videoSize)),
    }),
    "TikTok direct post init",
  );
  if (!json.data?.publish_id || !json.data.upload_url) {
    throw new Error("TikTok init missing publish_id or upload_url.");
  }
  return json.data;
}

export async function uploadChunks(uploadUrl: string, bytes: Uint8Array) {
  const plan = createChunkPlan(bytes.byteLength);
  for (let index = 0; index < plan.totalChunkCount; index += 1) {
    const start = index * plan.chunkSize;
    const end = Math.min(start + plan.chunkSize, bytes.byteLength) - 1;
    const chunk = bytes.subarray(start, end + 1);
    const body = new Blob([chunk as BlobPart], { type: "video/mp4" });
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${start}-${end}/${bytes.byteLength}`,
      },
      body,
    });
    if (!response.ok) {
      throw new Error(
        `TikTok upload failed: ${response.status} ${response.statusText} ${await response.text()}`,
      );
    }
  }
}

export async function fetchPublishStatus(accessToken: string, publishId: string) {
  return readJson<{
    data?: {
      status: string;
      fail_reason?: string;
      publicaly_available_post_id?: string[];
    };
  }>(
    await fetch(`${apiBase}/v2/post/publish/status/fetch/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ publish_id: publishId }),
    }),
    "TikTok status fetch",
  );
}
