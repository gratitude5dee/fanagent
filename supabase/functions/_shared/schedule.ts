type UnknownRecord = Record<string, unknown>;

export type TiktokOptions = {
  privacyLevel: string;
  disableDuet: boolean;
  disableStitch: boolean;
  disableComment: boolean;
  isAigc: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
};

export type ScheduleSlot = {
  libraryItemId: string;
  scheduledAt: string;
};

const privacyLevels = new Set([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);
const generatedSourceLabels = new Set(["seedance", "gmi", "gmi_seedance", "mixed"]);

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function cleanHashtags(values?: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .slice(0, 20);
}

function stringValue(row: UnknownRecord, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sourceLabelIndicatesAigc(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const label = value.trim().toLowerCase();
  return generatedSourceLabels.has(label) || label.includes("seedance");
}

function recordIndicatesAigc(value: unknown): boolean {
  const row = record(value);
  return [
    row.source,
    row.sourceType,
    row.source_type,
    row.sourceMode,
    row.source_mode,
    row.provider,
    row.model,
    row.model_id,
  ].some(sourceLabelIndicatesAigc);
}

function arrayIndicatesAigc(value: unknown): boolean {
  return Array.isArray(value) && value.some(recordIndicatesAigc);
}

function attributionFrom(value: unknown): string | null {
  const row = record(value);
  return stringValue(row, "attribution");
}

function collectAttributions(...sources: unknown[]): string[] {
  const attributions = new Set<string>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const value of source) {
      const attribution = attributionFrom(value);
      if (attribution) attributions.add(attribution);
    }
  }
  return Array.from(attributions);
}

function parseTime(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Invalid daily window time: ${value}`);
  }
  return { hour, minute };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  let parts: Record<string, number>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
  } catch {
    throw new Error(`Invalid timezone: ${timeZone}`);
  }

  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
}

function zonedDateFromDayAndTime(day: string, time: string, timeZone: string): Date {
  const { hour, minute } = parseTime(time);
  const [year, month, dayOfMonth] = day.split("-").map((part) => Number(part));
  const localUtc = Date.UTC(year, month - 1, dayOfMonth, hour, minute, 0, 0);
  if (!Number.isFinite(localUtc)) throw new Error(`Invalid startDate: ${day}`);

  let instant = localUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = localUtc - timeZoneOffsetMs(new Date(instant), timeZone);
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function interpolateWindowTimes(
  day: string,
  window: UnknownRecord,
  count: number,
  timeZone: string,
  jitterMinutes = 0,
  seedPrefix = "",
): string[] {
  const start = typeof window.start === "string" ? window.start : "09:00";
  const end = typeof window.end === "string" ? window.end : start;
  const startDate = zonedDateFromDayAndTime(day, start, timeZone);
  const endDate = zonedDateFromDayAndTime(day, end, timeZone);
  if (count <= 1 || endDate.getTime() <= startDate.getTime()) {
    return [
      applyJitterWithinRange(startDate, endDate, jitterMinutes, `${seedPrefix}:0`).toISOString(),
    ];
  }
  const stepMs = (endDate.getTime() - startDate.getTime()) / (count - 1);
  return Array.from({ length: count }, (_value, index) =>
    applyJitterWithinRange(
      new Date(startDate.getTime() + stepMs * index),
      endDate,
      jitterMinutes,
      `${seedPrefix}:${index}`,
    ).toISOString(),
  );
}

function normalizeJitterMinutes(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(Math.floor(numeric), 240));
}

function stableJitterFraction(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function jitterOffsetMs(seed: string, jitterMinutes: number): number {
  if (jitterMinutes <= 0) return 0;
  return Math.round(stableJitterFraction(seed) * jitterMinutes * 60_000);
}

function applyJitter(date: Date, jitterMinutes: number, seed: string): Date {
  return new Date(date.getTime() + jitterOffsetMs(seed, jitterMinutes));
}

function applyJitterWithinRange(
  date: Date,
  latest: Date,
  jitterMinutes: number,
  seed: string,
): Date {
  if (jitterMinutes <= 0) return date;
  const remainingMs = latest.getTime() - date.getTime();
  if (remainingMs <= 0) return date;
  const offsetMs = Math.min(jitterOffsetMs(seed, jitterMinutes), remainingMs);
  return new Date(date.getTime() + offsetMs);
}

export function inferAigcDefault(item: UnknownRecord): boolean {
  const metadata = record(item.metadata);
  const payload = record(item.input_payload);
  return (
    recordIndicatesAigc(item) ||
    recordIndicatesAigc(metadata) ||
    recordIndicatesAigc(payload) ||
    arrayIndicatesAigc(item.provenance) ||
    arrayIndicatesAigc(item.segments)
  );
}

export function normalizeTiktokOptions(input?: unknown, defaultIsAigc = true): TiktokOptions {
  const options = record(input);
  const privacyLevel = String(options.privacyLevel ?? options.privacy_level ?? "SELF_ONLY");
  if (!privacyLevels.has(privacyLevel)) throw new Error("Unsupported TikTok privacy level.");
  return {
    privacyLevel,
    disableDuet: bool(options.disableDuet ?? options.disable_duet, true),
    disableStitch: bool(options.disableStitch ?? options.disable_stitch, true),
    disableComment: bool(options.disableComment ?? options.disable_comment, false),
    isAigc: bool(options.isAigc ?? options.is_aigc, defaultIsAigc),
    brandContentToggle: bool(options.brandContentToggle ?? options.brand_content_toggle, false),
    brandOrganicToggle: bool(options.brandOrganicToggle ?? options.brand_organic_toggle, false),
  };
}

export function tiktokOptionsToSnake(options: TiktokOptions): UnknownRecord {
  return {
    privacy_level: options.privacyLevel,
    disable_duet: options.disableDuet,
    disable_stitch: options.disableStitch,
    disable_comment: options.disableComment,
    is_aigc: options.isAigc,
    brand_content_toggle: options.brandContentToggle,
    brand_organic_toggle: options.brandOrganicToggle,
  };
}

export function validateScheduledAt(value: unknown, now = new Date()): string {
  const scheduledAt = new Date(String(value ?? ""));
  if (!Number.isFinite(scheduledAt.getTime()))
    throw new Error("scheduledAt must be a valid ISO date.");
  if (scheduledAt.getTime() < now.getTime() - 60_000) {
    throw new Error("scheduledAt cannot be more than one minute in the past.");
  }
  const maxFuture = now.getTime() + 90 * 24 * 60 * 60 * 1000;
  if (scheduledAt.getTime() > maxFuture) {
    throw new Error("scheduledAt cannot be more than 90 days in the future.");
  }
  return scheduledAt.toISOString();
}

export function validateReadyLibraryItem(item: UnknownRecord): void {
  if (item.status !== "ready") {
    throw new Error(`Library item ${String(item.id ?? "")} is not ready.`);
  }
  if (!item.final_asset_id) {
    throw new Error(`Library item ${String(item.id ?? "")} is missing a final asset.`);
  }
}

export function buildBulkScheduleSlots(
  libraryItemIds: string[],
  rule: UnknownRecord,
): ScheduleSlot[] {
  const ids = libraryItemIds.slice(0, 50);
  const type = String(rule.type ?? "cadence");
  const jitterMinutes = normalizeJitterMinutes(rule.jitterMinutes ?? rule.jitter_minutes);
  if (type === "manual_slots") {
    const slots = Array.isArray(rule.slots) ? rule.slots : [];
    if (slots.length < ids.length) throw new Error("manual_slots requires one slot per item.");
    return ids.map((libraryItemId, index) => ({
      libraryItemId,
      scheduledAt: new Date(String(record(slots[index]).scheduledAt)).toISOString(),
    }));
  }

  if (type === "daily_windows") {
    const windows = Array.isArray(rule.windows) ? rule.windows.map(record) : [];
    if (windows.length === 0) throw new Error("daily_windows requires at least one window.");
    const startDate = String(rule.startDate ?? new Date().toISOString().slice(0, 10));
    const timeZone =
      typeof rule.timezone === "string" && rule.timezone.trim() ? rule.timezone.trim() : "UTC";
    const maxPerDay = Math.max(1, Math.min(Math.floor(Number(rule.maxPerDay ?? 4)), 50));
    const perWindow = Math.max(1, Math.ceil(maxPerDay / windows.length));
    const output: ScheduleSlot[] = [];
    let dayOffset = 0;
    while (output.length < ids.length) {
      const day = addDays(startDate, dayOffset);
      const dayTimes = windows
        .flatMap((window, windowIndex) =>
          interpolateWindowTimes(
            day,
            window,
            perWindow,
            timeZone,
            jitterMinutes,
            `${day}:${windowIndex}`,
          ),
        )
        .slice(0, maxPerDay);
      for (const scheduledAt of dayTimes) {
        const libraryItemId = ids[output.length];
        if (!libraryItemId) break;
        output.push({ libraryItemId, scheduledAt });
      }
      dayOffset += 1;
    }
    return output;
  }

  if (type !== "cadence") throw new Error(`Unsupported schedule rule type: ${type}`);
  const startAt = new Date(String(rule.startAt ?? ""));
  if (!Number.isFinite(startAt.getTime())) throw new Error("cadence rule requires startAt.");
  const everyMinutes = Math.max(5, Math.min(Math.floor(Number(rule.everyMinutes ?? 240)), 10_080));
  return ids.map((libraryItemId, index) => ({
    libraryItemId,
    scheduledAt: applyJitter(
      new Date(startAt.getTime() + index * everyMinutes * 60_000),
      jitterMinutes,
      `${libraryItemId}:${index}`,
    ).toISOString(),
  }));
}

export function buildScheduledPostRow(input: {
  item: UnknownRecord;
  asset?: UnknownRecord | null;
  scheduledAt: string;
  caption?: string;
  hashtags?: string[];
  tiktokOptions?: unknown;
}): UnknownRecord {
  validateReadyLibraryItem(input.item);
  const options = normalizeTiktokOptions(input.tiktokOptions, inferAigcDefault(input.item));
  const hashtags =
    input.hashtags && input.hashtags.length
      ? cleanHashtags(input.hashtags)
      : cleanHashtags(input.item.default_hashtags);
  const caption =
    typeof input.caption === "string" && input.caption.trim()
      ? input.caption.trim()
      : String(input.item.default_caption ?? "sound on").trim();
  const asset = record(input.asset);
  const attributions = collectAttributions(input.item.provenance, input.item.segments);
  return {
    account_id: input.item.account_id,
    batch_id: input.item.batch_id ?? null,
    generation_item_id: input.item.generation_item_id ?? null,
    library_item_id: input.item.id,
    final_asset_id: input.item.final_asset_id,
    video_url: asset.public_url ?? null,
    caption: caption.slice(0, 2200),
    hashtags,
    scheduled_at: validateScheduledAt(input.scheduledAt),
    status: "pending",
    publish_status: "ready",
    platform: "tiktok",
    post_type: "video",
    tiktok_privacy_level: options.privacyLevel,
    tiktok_disable_duet: options.disableDuet,
    tiktok_disable_stitch: options.disableStitch,
    tiktok_disable_comment: options.disableComment,
    tiktok_is_aigc: options.isAigc,
    tiktok_brand_content: options.brandContentToggle,
    tiktok_brand_organic: options.brandOrganicToggle,
    privacy_settings: tiktokOptionsToSnake(options),
    metadata: {
      attributions,
      audio_clip_id: input.item.audio_clip_id ?? null,
      library_item_id: input.item.id,
      duration_seconds: Number(input.item.duration_sec ?? 0) || null,
    },
  };
}

export function scheduledPostResponse(
  post: UnknownRecord,
  asset?: UnknownRecord | null,
): UnknownRecord {
  const media = record(asset);
  const postMetadata = record(post.metadata);
  return {
    ...post,
    media: {
      asset_id: post.final_asset_id ?? null,
      public_url: media.public_url ?? post.video_url ?? null,
      mime_type: media.mime_type ?? "video/mp4",
      duration_seconds:
        media.duration_seconds ?? media.duration_sec ?? postMetadata.duration_seconds ?? null,
      width: media.width ?? record(media.metadata).width ?? null,
      height: media.height ?? record(media.metadata).height ?? null,
    },
    tiktok_options: {
      privacy_level: post.tiktok_privacy_level ?? null,
      disable_duet: post.tiktok_disable_duet ?? null,
      disable_stitch: post.tiktok_disable_stitch ?? null,
      disable_comment: post.tiktok_disable_comment ?? null,
      is_aigc: post.tiktok_is_aigc ?? null,
      brand_content_toggle: post.tiktok_brand_content ?? null,
      brand_organic_toggle: post.tiktok_brand_organic ?? null,
    },
  };
}
