import type { LibraryItem, LibraryStatus } from "./types";

export type LibraryTone = "good" | "warn" | "bad" | "idle";

export function libraryStatusTone(status: LibraryStatus): LibraryTone {
  if (["ready", "posted"].includes(status)) return "good";
  if (["scheduled", "blocked"].includes(status)) return "warn";
  if (["failed", "archived"].includes(status)) return "bad";
  return "idle";
}

function searchableText(item: LibraryItem): string {
  const segmentText = item.segments
    .map((segment) =>
      [segment.source, segment.provider, segment.query, segment.prompt, segment.externalId]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
  return [item.default_caption, item.default_hashtags.join(" "), segmentText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterLibraryItems(
  items: LibraryItem[],
  filters: { status: LibraryStatus; query: string },
): LibraryItem[] {
  const query = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.status !== "all" && item.status !== filters.status) return false;
    if (!query) return true;
    return searchableText(item).includes(query);
  });
}

export function selectedRegeneratableIds(items: LibraryItem[], selectedIds: Set<string>): string[] {
  return items
    .filter((item) => selectedIds.has(item.id) && item.generation_item_id)
    .map((item) => item.generation_item_id as string);
}
