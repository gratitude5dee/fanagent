import type { LibraryItem, LibraryStatus } from "./types";

export type LibraryTone = "good" | "warn" | "bad" | "idle";
export type LibraryStatusFilter =
  | "all"
  | "unscheduled"
  | "scheduled"
  | "posted"
  | "blocked"
  | "failed";
export type LibrarySortMode = "distinct" | "created" | "next_scheduled" | "random";

export type LibraryQualityMarker = {
  key: string;
  label: string;
  tone: Extract<LibraryTone, "warn" | "bad" | "idle">;
};

export function libraryStatusTone(status: LibraryStatus): LibraryTone {
  if (["ready", "posted"].includes(status)) return "good";
  if (["scheduled", "blocked"].includes(status)) return "warn";
  if (["failed", "archived"].includes(status)) return "bad";
  return "idle";
}

function searchableText(item: LibraryItem): string {
  const segmentText = item.segments
    .map((segment) =>
      [
        segment.source,
        segment.provider,
        segment.query,
        segment.prompt,
        segment.externalId,
        segment.external_id,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
  return [
    item.default_caption,
    item.default_hashtags.join(" "),
    segmentText,
    libraryAttributionLines(item).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function statusMatches(item: LibraryItem, status: LibraryStatusFilter): boolean {
  if (status === "all") return true;
  if (status === "unscheduled") return item.status === "ready";
  return item.status === status;
}

function providerFrom(value: unknown): string | null {
  const row = record(value);
  for (const key of ["provider", "source", "source_type", "sourceType"]) {
    const raw = row[key];
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  }
  return null;
}

export function libraryDistinctnessScore(item: LibraryItem): number {
  const providers = new Set<string>();
  for (const source of [item.provenance, item.segments]) {
    for (const value of source) {
      const provider = providerFrom(value);
      if (provider) providers.add(provider);
    }
  }
  return providers.size;
}

export function sortLibraryItemsForDisplay(items: LibraryItem[]): LibraryItem[] {
  return [...items].sort((left, right) => {
    const distinctnessDelta = libraryDistinctnessScore(right) - libraryDistinctnessScore(left);
    if (distinctnessDelta !== 0) return distinctnessDelta;
    return left.library_index - right.library_index;
  });
}

function timestamp(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sortLibraryItems(
  items: LibraryItem[],
  sort: LibrarySortMode = "distinct",
  randomSeed = "library",
): LibraryItem[] {
  if (sort === "distinct") return sortLibraryItemsForDisplay(items);
  return [...items].sort((left, right) => {
    if (sort === "created") {
      const createdDelta = timestamp(left.created_at) - timestamp(right.created_at);
      if (createdDelta !== 0) return createdDelta;
      return left.library_index - right.library_index;
    }
    if (sort === "next_scheduled") {
      const scheduledDelta = timestamp(left.next_scheduled_at) - timestamp(right.next_scheduled_at);
      if (scheduledDelta !== 0) return scheduledDelta;
      return left.library_index - right.library_index;
    }
    const randomDelta =
      stableHash(`${randomSeed}:${left.id}`) - stableHash(`${randomSeed}:${right.id}`);
    if (randomDelta !== 0) return randomDelta;
    return left.library_index - right.library_index;
  });
}

export function filterLibraryItems(
  items: LibraryItem[],
  filters: {
    status: LibraryStatusFilter;
    query: string;
    sort?: LibrarySortMode;
    randomSeed?: string;
  },
): LibraryItem[] {
  const query = filters.query.trim().toLowerCase();
  return sortLibraryItems(
    items.filter((item) => {
      if (!statusMatches(item, filters.status)) return false;
      if (!query) return true;
      return searchableText(item).includes(query);
    }),
    filters.sort ?? "distinct",
    filters.randomSeed ?? "library",
  );
}

export function selectedRegeneratableIds(items: LibraryItem[], selectedIds: Set<string>): string[] {
  return items
    .filter((item) => selectedIds.has(item.id) && item.generation_item_id)
    .map((item) => item.generation_item_id as string);
}

export function selectedSchedulableIds(items: LibraryItem[], selectedIds: Set<string>): string[] {
  return items
    .filter((item) => selectedIds.has(item.id) && item.status === "ready" && item.final_asset_id)
    .map((item) => item.id);
}

export function canScheduleLibraryItem(item: LibraryItem): boolean {
  return item.status === "ready" && !!item.final_asset_id;
}

export function libraryDownloadUrl(item: LibraryItem): string | null {
  return item.media?.public_url ?? null;
}

export function libraryDownloadFileName(item: LibraryItem): string {
  return `fanagent-clip-${item.library_index + 1}.mp4`;
}

export function libraryCaptionText(item: LibraryItem): string {
  const caption = item.default_caption?.trim() ?? "";
  const hashtags = item.default_hashtags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .join(" ");
  return [caption, hashtags].filter(Boolean).join("\n\n");
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function attributionFrom(value: unknown): string | null {
  const attribution = record(value).attribution;
  return typeof attribution === "string" && attribution.trim().length > 0
    ? attribution.trim()
    : null;
}

export function libraryAttributionLines(item: LibraryItem): string[] {
  const attributions = new Set<string>();
  for (const source of [item.provenance, item.segments]) {
    for (const value of source) {
      const attribution = attributionFrom(value);
      if (attribution) attributions.add(attribution);
    }
  }
  return Array.from(attributions);
}

function reusedFrom(value: unknown): boolean {
  return record(value).reused === true;
}

function toleranceFrom(value: unknown): number | null {
  const row = record(value);
  const raw = row.tolerance_seconds_used ?? row.toleranceSec ?? row.tolerance_seconds;
  const tolerance = Number(raw);
  return Number.isFinite(tolerance) ? tolerance : null;
}

export function libraryQualityMarkers(item: LibraryItem): LibraryQualityMarker[] {
  const markers: LibraryQualityMarker[] = [];
  const sources = [...item.provenance, ...item.segments];
  const hasReusedFlag = Object.values(item.reused_flags).some(Boolean);
  if (hasReusedFlag || sources.some(reusedFrom)) {
    markers.push({ key: "reused", label: "reused source", tone: "warn" });
  }
  if (sources.some((value) => (toleranceFrom(value) ?? 0) >= 10)) {
    markers.push({ key: "fallback", label: "10s fallback", tone: "warn" });
  }
  return markers;
}

export function librarySegmentTargetDurationSeconds(
  item: LibraryItem,
  segmentIndex: number,
): number {
  const segment = item.segments[segmentIndex];
  const explicit = Number(segment?.durationSec ?? segment?.duration_seconds ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return Math.max(1, Math.ceil(item.duration_sec / Math.max(1, item.segments.length || 1)));
}

export function toLocalScheduleInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function defaultSingleScheduleInput(now = new Date()): string {
  return toLocalScheduleInputValue(new Date(now.getTime() + 30 * 60_000));
}

export function parseSingleScheduleInput(value: string): string {
  const scheduledAt = new Date(value);
  if (!Number.isFinite(scheduledAt.getTime())) {
    throw new Error("Choose a valid schedule time.");
  }
  return scheduledAt.toISOString();
}
