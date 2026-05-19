import type { EventInput } from "@fullcalendar/core";

export const TIKTOK_PRIVACY_LEVELS = [
  "SELF_ONLY",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "PUBLIC_TO_EVERYONE",
];

export const CALENDAR_VIEWS = ["month", "week", "day", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const CALENDAR_STATUS_FILTERS = [
  "all",
  "pending",
  "posting",
  "posted",
  "failed",
  "skipped",
  "blocked",
] as const;
export type CalendarStatusFilter = (typeof CALENDAR_STATUS_FILTERS)[number];

export type CalendarFilters = {
  accountId: string;
  audioClipId: string;
  status: CalendarStatusFilter;
};

export type CalendarPost = {
  id: string;
  account_id: string;
  caption: string;
  hashtags: string[] | null;
  scheduled_at: string;
  status: string;
  publish_status: string | null;
  video_url: string | null;
  library_item_id?: string | null;
  tiktok_privacy_level: string | null;
  tiktok_disable_duet: boolean | null;
  tiktok_disable_stitch: boolean | null;
  tiktok_disable_comment: boolean | null;
  tiktok_is_aigc: boolean | null;
  tiktok_brand_content: boolean | null;
  tiktok_brand_organic: boolean | null;
  tiktok_post_id: string | null;
  posted_at: string | null;
};

export type CalendarLibraryPreview = {
  id: string;
  audio_clip_id: string;
  library_index: number;
  duration_sec: number;
  status: string;
  segments: unknown[];
  provenance: unknown[];
};

export type CalendarLibraryFilterItem = {
  id: string;
  account_id: string;
  audio_clip_id: string;
};

export type CalendarAccount = {
  id: string;
  handle: string | null;
  tiktok_creator_info: Record<string, unknown> | null;
};

export type TikTokPrivacySettingsInput = {
  privacyLevel: string | null;
  disableDuet: boolean;
  disableStitch: boolean;
  disableComment: boolean;
  isAigc: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
};

export function eventClass(post: Pick<CalendarPost, "status" | "publish_status">): string {
  if (post.publish_status?.startsWith("blocked_")) return "event-blocked";
  if (post.status === "posted" || post.publish_status === "publish_complete") return "event-good";
  if (post.status === "failed" || post.publish_status === "failed") return "event-bad";
  if (post.status === "posting" || post.publish_status === "processing") return "event-warn";
  if (post.status === "skipped") return "event-muted";
  return "event-idle";
}

export function statusTone(post: Pick<CalendarPost, "status" | "publish_status">): string {
  if (post.publish_status?.startsWith("blocked_")) return "warn";
  if (post.status === "posted" || post.publish_status === "publish_complete") return "good";
  if (post.status === "failed" || post.publish_status === "failed") return "bad";
  if (post.status === "posting" || post.publish_status === "processing") return "warn";
  return "idle";
}

export function publishStatusLabel(status: string | null): string {
  return status ? status.replaceAll("_", " ") : "not sent";
}

export function needsTikTokConnection(post: Pick<CalendarPost, "publish_status">): boolean {
  return post.publish_status === "blocked_account_not_connected";
}

export function calendarEventForPost(post: CalendarPost): EventInput {
  return {
    id: post.id,
    title: post.caption || "Scheduled post",
    start: post.scheduled_at,
    classNames: [eventClass(post)],
    editable: post.status !== "posted",
  };
}

function postMatchesStatus(
  post: Pick<CalendarPost, "status" | "publish_status">,
  status: CalendarStatusFilter,
): boolean {
  if (status === "all") return true;
  if (status === "blocked") return post.publish_status?.startsWith("blocked_") ?? false;
  return post.status === status;
}

export function filterCalendarPosts(
  posts: CalendarPost[],
  previews: CalendarLibraryPreview[],
  filters: CalendarFilters,
): CalendarPost[] {
  const previewById = new Map(previews.map((preview) => [preview.id, preview]));
  return posts.filter((post) => {
    if (filters.accountId && post.account_id !== filters.accountId) return false;
    if (filters.audioClipId) {
      const preview = post.library_item_id ? previewById.get(post.library_item_id) : null;
      if (preview?.audio_clip_id !== filters.audioClipId) return false;
    }
    return postMatchesStatus(post, filters.status);
  });
}

export function filterCalendarLibraryItems<T extends CalendarLibraryFilterItem>(
  items: T[],
  filters: Pick<CalendarFilters, "accountId" | "audioClipId">,
): T[] {
  return items.filter((item) => {
    if (filters.accountId && item.account_id !== filters.accountId) return false;
    if (filters.audioClipId && item.audio_clip_id !== filters.audioClipId) return false;
    return true;
  });
}

export function isPostReadOnly(post: Pick<CalendarPost, "status">): boolean {
  return post.status === "posted";
}

export function isPastScheduleDrop(date: Date, now = new Date()): boolean {
  return date.getTime() < now.getTime();
}

export function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function localDateFromInputValue(value: string): string {
  const datePart = value.split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  throw new Error("Start date must be a valid local date.");
}

export function buildDefaultManualSlotValues(
  count: number,
  startAt: string,
  everyMinutes: number,
): string[] {
  const startDate = new Date(startAt);
  const safeCount = Math.max(0, Math.floor(count));
  if (!Number.isFinite(startDate.getTime())) return Array.from({ length: safeCount }, () => "");
  const safeEveryMinutes = Number.isFinite(everyMinutes) ? everyMinutes : 240;
  const intervalMs = Math.max(5, Math.floor(safeEveryMinutes)) * 60_000;
  return Array.from({ length: safeCount }, (_value, index) =>
    toLocalInputValue(new Date(startDate.getTime() + index * intervalMs)),
  );
}

export function buildManualSlotsRule(slotValues: string[]): {
  type: "manual_slots";
  slots: Array<{ scheduledAt: string }>;
} {
  return {
    type: "manual_slots",
    slots: slotValues.map((value, index) => {
      const scheduledAt = new Date(value);
      if (!Number.isFinite(scheduledAt.getTime())) {
        throw new Error(`Manual slot ${index + 1} must be a valid date and time.`);
      }
      return { scheduledAt: scheduledAt.toISOString() };
    }),
  };
}

export function creatorPrivacyOptions(creatorInfo: Record<string, unknown> | null): string[] {
  const options = creatorInfo?.privacy_level_options;
  return Array.isArray(options)
    ? options.map(String).filter((option) => TIKTOK_PRIVACY_LEVELS.includes(option))
    : [];
}

export function isPrivacyLevelAvailable(
  level: string,
  creatorInfo: Record<string, unknown> | null,
): boolean {
  const options = creatorPrivacyOptions(creatorInfo);
  return options.length === 0 || options.includes(level);
}

export function isCreatorCommentDisabled(creatorInfo: Record<string, unknown> | null): boolean {
  return creatorInfo?.comment_disabled === true;
}

export function buildTikTokPrivacySettings(
  input: TikTokPrivacySettingsInput,
): Record<string, unknown> {
  return {
    privacy_level: input.privacyLevel,
    disable_duet: input.disableDuet,
    disable_stitch: input.disableStitch,
    disable_comment: input.disableComment,
    is_aigc: input.isAigc,
    brand_content_toggle: input.brandContentToggle,
    brand_organic_toggle: input.brandOrganicToggle,
  };
}

export function tiktokPostUrl(
  post: Pick<CalendarPost, "tiktok_post_id">,
  account?: Pick<CalendarAccount, "handle"> | null,
): string | null {
  if (!post.tiktok_post_id || !account?.handle) return null;
  const handle = account.handle.replace(/^@+/, "").trim();
  if (!handle) return null;
  return `https://www.tiktok.com/@${encodeURIComponent(handle)}/video/${encodeURIComponent(
    post.tiktok_post_id,
  )}`;
}

function stringValue(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function provenanceLabel(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const source = stringValue(row, "source") ?? stringValue(row, "source_type");
  const provider = stringValue(row, "provider");
  const externalId = stringValue(row, "externalId") ?? stringValue(row, "external_id");
  if (provider && externalId) return `${provider}:${externalId}`;
  if (provider) return provider;
  if (source && externalId) return `${source}:${externalId}`;
  return source;
}

export function provenanceSummary(preview?: CalendarLibraryPreview | null): string {
  if (!preview) return "No library item linked";
  const labels = [...preview.provenance, ...preview.segments]
    .map(provenanceLabel)
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? Array.from(new Set(labels)).slice(0, 4).join(" + ") : "No provenance";
}
