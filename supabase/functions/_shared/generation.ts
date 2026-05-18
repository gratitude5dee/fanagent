export const sourceModes = [
  "stock",
  "mixed",
  "seedance",
  "gmi_seedance",
  "sports_edit",
  "streamer_clip",
] as const;
export type SourceMode = (typeof sourceModes)[number];
export type VideoDuration = 15 | 30 | 45 | 60 | 75 | 90;
export type ClipSelection = {
  startSec: number;
  endSec: number;
  durationSec: number;
  originalFileName?: string;
};

export type StockCandidateIdentity = {
  provider?: string | null;
  externalId?: string | null;
  url?: string | null;
};

export type SegmentMetadata = {
  source?: string;
  url?: string | null;
  provider?: string | null;
  externalId?: string | null;
  query?: string | null;
  durationSec?: number | null;
  reused?: boolean | null;
  prompt?: string | null;
};

export type SegmentVisualPlan = {
  prompt: string;
  query: string;
  mood: string;
  cameraMovement: string;
  lyricContext: string;
};

export function normalizeSourceMode(value: unknown): SourceMode {
  if (value === "hybrid") return "mixed";
  return sourceModes.includes(value as SourceMode) ? (value as SourceMode) : "stock";
}

export function sourceModeNeedsFal(value: SourceMode): boolean {
  return value === "mixed" || value === "seedance";
}

export function sourceModeNeedsGmi(value: SourceMode): boolean {
  return value === "gmi_seedance";
}

const themes = ["cinematic", "aesthetic", "street", "nature", "abstract"] as const;
const moods = ["charged", "intimate", "glossy", "kinetic", "dreamlike", "late-night"];
const segmentMoods = [
  "charged",
  "intimate",
  "glossy",
  "kinetic",
  "dreamlike",
  "late-night",
  "euphoric",
  "moody",
  "sunlit",
  "electric",
] as const;
const cameraMovements = [
  "slow push-in",
  "sideways tracking move",
  "low-angle rise",
  "overhead drift",
  "handheld follow",
  "locked-off graphic frame",
  "orbiting reveal",
  "snap zoom accent",
] as const;
const visualMotifs = [
  "stage lights",
  "city crosswalk",
  "bedroom mirror",
  "tour van window",
  "record store aisle",
  "rooftop skyline",
  "club entrance",
  "rainy street reflection",
  "backstage corridor",
  "crowd silhouettes",
  "neon diner",
  "subway platform",
] as const;
const palettes = [
  "clean monochrome with teal accents",
  "warm amber practical light",
  "cool blue night contrast",
  "high-key daylight pop",
  "silver highlights and red accent hits",
  "soft green and gold natural tones",
] as const;

function pick<T>(values: readonly T[], index: number): T {
  return values[index % values.length];
}

function cleanPrompt(value?: string): string {
  return (value || "music-driven fan edit with cinematic lifestyle visuals")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function cleanContext(value?: string): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
}

export function normalizeClipSelection(
  value: unknown,
  fallbackDurationSec?: number,
  originalFileName?: string,
): ClipSelection | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const startSec = Number(raw.startSec ?? 0);
  const endSec = Number(raw.endSec);
  const requestedDuration = Number(raw.durationSec ?? fallbackDurationSec ?? endSec - startSec);

  if (
    !Number.isFinite(startSec) ||
    !Number.isFinite(endSec) ||
    !Number.isFinite(requestedDuration)
  ) {
    return null;
  }
  if (startSec < 0 || endSec <= startSec || requestedDuration <= 0) return null;

  return {
    startSec: roundSeconds(startSec),
    endSec: roundSeconds(endSec),
    durationSec: roundSeconds(Math.min(requestedDuration, endSec - startSec)),
    originalFileName:
      typeof raw.originalFileName === "string" && raw.originalFileName.trim()
        ? raw.originalFileName.trim().slice(0, 240)
        : originalFileName,
  };
}

export function stockIdentityKeys(identity: StockCandidateIdentity): string[] {
  const keys: string[] = [];
  const provider = identity.provider?.trim();
  const externalId = identity.externalId?.trim();
  const url = identity.url?.trim();
  if (provider && externalId) keys.push(`${provider}:${externalId}`);
  if (url) keys.push(url);
  return keys;
}

function isSegmentMetadata(value: unknown): value is SegmentMetadata {
  return !!value && typeof value === "object";
}

export function collectUsedStockKeys(
  rows: Array<{ segments?: unknown; stock_clip_url?: string | null }>,
): Set<string> {
  const used = new Set<string>();

  for (const row of rows) {
    if (row.stock_clip_url) used.add(row.stock_clip_url);
    const segments = Array.isArray(row.segments) ? row.segments : [];
    for (const segment of segments) {
      if (!isSegmentMetadata(segment)) continue;
      if (segment.source && segment.source !== "stock") continue;
      for (const key of stockIdentityKeys(segment)) used.add(key);
    }
  }

  return used;
}

export function selectStockCandidate<T extends StockCandidateIdentity>(
  candidates: T[],
  usedKeys: Set<string>,
  options: {
    avoidReuseWithinBatch?: boolean;
    allowReuseWhenExhausted?: boolean;
  } = {},
): { candidate: T; reused: boolean } | null {
  if (candidates.length === 0) return null;
  const avoidReuseWithinBatch = options.avoidReuseWithinBatch !== false;
  const allowReuseWhenExhausted = options.allowReuseWhenExhausted !== false;

  if (!avoidReuseWithinBatch) return { candidate: candidates[0], reused: false };

  const unused = candidates.find((candidate) =>
    stockIdentityKeys(candidate).every((key) => !usedKeys.has(key)),
  );
  if (unused) return { candidate: unused, reused: false };
  if (!allowReuseWhenExhausted) return null;
  return { candidate: candidates[0], reused: true };
}

export function createStockSegment(input: {
  clip: StockCandidateIdentity & { durationSec?: number };
  url: string;
  query: string;
  reused: boolean;
}): SegmentMetadata {
  return {
    source: "stock",
    url: input.url,
    provider: input.clip.provider ?? null,
    externalId: input.clip.externalId ?? null,
    query: input.query,
    durationSec: input.clip.durationSec ?? null,
    reused: input.reused,
  };
}

export function createSegmentVisualPlan(input: {
  basePrompt?: string;
  itemIndex: number;
  segmentIndex: number;
  totalSegments?: number;
  durationSeconds?: number;
  transcriptContext?: string;
}): SegmentVisualPlan {
  const subject = cleanPrompt(input.basePrompt);
  const seed = input.itemIndex * 7 + input.segmentIndex * 3;
  const mood = pick(segmentMoods, seed);
  const cameraMovement = pick(cameraMovements, seed + input.itemIndex);
  const motif = pick(visualMotifs, seed + input.segmentIndex);
  const palette = pick(palettes, seed + input.itemIndex + input.segmentIndex);
  const lyricContext = cleanContext(input.transcriptContext);
  const querySubject = subject.slice(0, 64);
  const segmentLabel = `post ${input.itemIndex + 1}, segment ${input.segmentIndex + 1}`;
  const duration = Math.max(1, Math.min(Math.round(input.durationSeconds ?? 15), 15));
  const lyricClause = lyricContext ? `lyric cue: ${lyricContext}` : "music-synced visual accents";

  return {
    mood,
    cameraMovement,
    lyricContext,
    query: [motif, mood, palette, querySubject, lyricContext]
      .filter(Boolean)
      .join(" ")
      .slice(0, 120),
    prompt: [
      `${subject}, distinct vertical scene for ${segmentLabel}`,
      `${motif} visual motif, ${mood} mood, ${cameraMovement}`,
      `${palette}, 9:16 social-video framing, no logos or watermarks`,
      `${lyricClause}`,
      `${duration} second segment with a clean end frame for stitching`,
    ].join(", "),
  };
}

export function buildBatchSettings(input: {
  stockSettings?: Record<string, unknown>;
  seedanceSettings?: Record<string, unknown>;
  clipSelection?: ClipSelection | null;
}): Record<string, unknown> {
  return {
    stock: input.stockSettings ?? {},
    seedance: input.seedanceSettings ?? {},
    ...(input.clipSelection ? { clipSelection: input.clipSelection } : {}),
  };
}

export function buildGenerationItemInputPayload(input: {
  sourceMode: SourceMode;
  promptPlan: unknown;
  audioAssetId: string;
  audioClipId?: string | null;
  libraryItemId?: string | null;
  durationSeconds: number;
  durationTolerance?: {
    preferredSeconds?: number;
    fallbackSeconds?: number;
  };
  stockSettings?: Record<string, unknown>;
  seedanceSettings?: Record<string, unknown>;
  publishDefaults?: Record<string, unknown>;
  clipSelection?: ClipSelection | null;
}): Record<string, unknown> {
  return {
    source_mode: input.sourceMode,
    prompt_plan: input.promptPlan,
    audio_asset_id: input.audioAssetId,
    ...(input.audioClipId ? { audio_clip_id: input.audioClipId } : {}),
    ...(input.libraryItemId ? { library_item_id: input.libraryItemId } : {}),
    duration_seconds: input.durationSeconds,
    ...(input.durationTolerance
      ? {
          duration_tolerance: {
            preferred_seconds: input.durationTolerance.preferredSeconds ?? 5,
            fallback_seconds: input.durationTolerance.fallbackSeconds ?? 10,
          },
        }
      : {}),
    stock_settings: input.stockSettings ?? {},
    seedance_settings: input.seedanceSettings ?? {},
    publish_defaults: input.publishDefaults ?? {},
    ...(input.clipSelection ? { clip_selection: input.clipSelection } : {}),
  };
}

export function createRegenerationReset(
  updatedAt = new Date().toISOString(),
): Record<string, unknown> {
  return {
    status: "pending",
    segments: null,
    stock_clip_url: null,
    final_asset_id: null,
    generated_asset_id: null,
    stitched_asset_id: null,
    render_provider: null,
    render_job_id: null,
    provider_request_id: null,
    post_id: null,
    locked_at: null,
    locked_by: null,
    error_message: null,
    stage_events: [],
    updated_at: updatedAt,
  };
}

export function createPromptPlan(input: {
  basePrompt?: string;
  index: number;
  total: number;
  durationSeconds?: VideoDuration;
}) {
  const subject = cleanPrompt(input.basePrompt);
  const theme = pick(themes, input.index);
  const mood = pick(moods, input.index);
  const duration = input.durationSeconds ?? 15;
  const shotSize =
    input.index % 3 === 0
      ? "wide vertical frame"
      : input.index % 3 === 1
        ? "medium close vertical frame"
        : "profile close-up vertical frame";
  const movement =
    input.index % 2 === 0
      ? "slow push-in with steady gimbal movement"
      : "sideways tracking move with gentle handheld energy";

  return {
    prompt: [
      `${subject}, one complete vertical social video shot`,
      `context: ${theme} environment timed to an uploaded music reference`,
      `framed as a ${shotSize}, normal lens feel, shallow background separation`,
      movement,
      "soft practical light, visible atmosphere, practical reflections, no logos or watermarks",
      "polished short-form music edit grade",
      `${duration} seconds, 9:16 aspect ratio, leave clean space for caption text`,
    ].join(", "),
    caption: `${input.index % 2 === 0 ? "wait for it" : "sound on"}. ${subject}`.slice(0, 140),
    hookText: input.index % 2 === 0 ? "wait for it" : "sound on",
    hashtags: ["#fyp", "#music", "#edit", "#fanpage", "#newmusic", "#viral"],
    videoPrompt: {
      theme,
      mood,
      duration_seconds: duration,
      aspect_ratio: "9:16",
    },
  };
}

export function buildSchedule(startAt: Date, count: number, cadenceMinutes: number): Date[] {
  const safeCount = Math.max(1, Math.min(Math.floor(count), 250));
  const safeCadence = Math.max(5, Math.min(Math.floor(cadenceMinutes), 7 * 24 * 60));
  return Array.from(
    { length: safeCount },
    (_, index) => new Date(startAt.getTime() + index * safeCadence * 60_000),
  );
}

export function findGmiVideoUrl(outcome: unknown): string | undefined {
  if (!outcome || typeof outcome !== "object") return undefined;
  if ("video_url" in outcome && typeof outcome.video_url === "string") {
    return outcome.video_url;
  }
  if ("url" in outcome && typeof outcome.url === "string" && /\.(mp4|mov)(\?|$)/i.test(outcome.url))
    return outcome.url;
  for (const value of Object.values(outcome)) {
    if (typeof value === "string" && /\.(mp4|mov)(\?|$)/i.test(value)) {
      return value;
    }
    const nested = findGmiVideoUrl(value);
    if (nested) return nested;
  }
  return undefined;
}
