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

export function createChunkPlan(videoSize: number): { chunkSize: number; totalChunkCount: number } {
  const chunkSize = Math.min(10 * 1024 * 1024, Math.max(videoSize, 1));

  return {
    chunkSize,
    totalChunkCount: Math.max(1, Math.ceil(videoSize / chunkSize)),
  };
}

export function buildDirectPostInitBody(
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

export function isTikTokPrivacyLevelAllowed(
  privacyLevel: string | null | undefined,
  creatorInfo: { privacy_level_options?: unknown },
): boolean {
  if (!privacyLevel) return false;
  const options = Array.isArray(creatorInfo.privacy_level_options)
    ? creatorInfo.privacy_level_options.map(String)
    : [];
  return options.length === 0 || options.includes(privacyLevel);
}

export function parseTikTokStatusResponse(raw: string): {
  status: string;
  fail_reason?: string | null;
  publicaly_available_post_id?: string[];
} {
  const parsed = JSON.parse(raw) as {
    data?: {
      status?: string;
      fail_reason?: string | null;
      publicaly_available_post_id?: string[];
    };
    error?: { code?: string; message?: string };
  };

  if (parsed.error?.code && parsed.error.code !== "ok") {
    throw new Error(
      `TikTok status fetch failed: ${parsed.error.code} ${parsed.error.message ?? ""}`.trim(),
    );
  }

  if (!parsed.data?.status) {
    throw new Error("TikTok status response missing data.status.");
  }

  return parsed.data as {
    status: string;
    fail_reason?: string | null;
    publicaly_available_post_id?: string[];
  };
}
