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

function parseTime(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid daily window time: ${value}`);
  }
  return { hour, minute };
}

function dateFromDayAndTime(day: string, time: string): Date {
  const { hour, minute } = parseTime(time);
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid startDate: ${day}`);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function interpolateWindowTimes(day: string, window: UnknownRecord, count: number): string[] {
  const start = typeof window.start === "string" ? window.start : "09:00";
  const end = typeof window.end === "string" ? window.end : start;
  const startDate = dateFromDayAndTime(day, start);
  const endDate = dateFromDayAndTime(day, end);
  if (count <= 1 || endDate.getTime() <= startDate.getTime()) return [startDate.toISOString()];
  const stepMs = (endDate.getTime() - startDate.getTime()) / (count - 1);
  return Array.from({ length: count }, (_value, index) =>
    new Date(startDate.getTime() + stepMs * index).toISOString(),
  );
}

export function normalizeTiktokOptions(input?: unknown): TiktokOptions {
  const options = record(input);
  const privacyLevel = String(options.privacyLevel ?? options.privacy_level ?? "SELF_ONLY");
  if (!privacyLevels.has(privacyLevel)) throw new Error("Unsupported TikTok privacy level.");
  return {
    privacyLevel,
    disableDuet: bool(options.disableDuet ?? options.disable_duet, true),
    disableStitch: bool(options.disableStitch ?? options.disable_stitch, true),
    disableComment: bool(options.disableComment ?? options.disable_comment, false),
    isAigc: bool(options.isAigc ?? options.is_aigc, true),
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
  if (!Number.isFinite(scheduledAt.getTime())) throw new Error("scheduledAt must be a valid ISO date.");
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
    const maxPerDay = Math.max(1, Math.min(Math.floor(Number(rule.maxPerDay ?? 4)), 50));
    const perWindow = Math.max(1, Math.ceil(maxPerDay / windows.length));
    const output: ScheduleSlot[] = [];
    let dayOffset = 0;
    while (output.length < ids.length) {
      const day = addDays(startDate, dayOffset);
      const dayTimes = windows
        .flatMap((window) => interpolateWindowTimes(day, window, perWindow))
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
    scheduledAt: new Date(startAt.getTime() + index * everyMinutes * 60_000).toISOString(),
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
  const options = normalizeTiktokOptions(input.tiktokOptions);
  const hashtags =
    input.hashtags && input.hashtags.length
      ? cleanHashtags(input.hashtags)
      : cleanHashtags(input.item.default_hashtags);
  const caption =
    typeof input.caption === "string" && input.caption.trim()
      ? input.caption.trim()
      : String(input.item.default_caption ?? "sound on").trim();
  const asset = record(input.asset);
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
  };
}

export function scheduledPostResponse(post: UnknownRecord, asset?: UnknownRecord | null): UnknownRecord {
  const media = record(asset);
  return {
    ...post,
    media: {
      asset_id: post.final_asset_id ?? null,
      public_url: media.public_url ?? post.video_url ?? null,
      mime_type: media.mime_type ?? "video/mp4",
      duration_seconds: media.duration_sec ?? null,
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
