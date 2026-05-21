import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canScheduleLibraryItem,
  canRegenerateLibraryItem,
  defaultSingleScheduleInput,
  filterLibraryItems,
  libraryAttributionLines,
  libraryCaptionText,
  libraryDistinctnessScore,
  libraryDownloadFileName,
  libraryDownloadUrl,
  libraryQualityMarkers,
  librarySegmentTargetDurationSeconds,
  libraryStatusTone,
  parseSingleScheduleInput,
  selectedRegeneratableIds,
  selectedRegeneratableTargets,
  selectedSchedulableIds,
  sortLibraryItems,
  sortLibraryItemsForDisplay,
  toLocalScheduleInputValue,
} from "../src/lib/library/ui";
import type { LibraryItem } from "../src/lib/library/types";

const items: LibraryItem[] = [
  {
    id: "item-ready",
    account_id: "account-1",
    audio_clip_id: "clip-1",
    batch_id: "batch-1",
    generation_item_id: "generation-1",
    library_index: 0,
    status: "ready",
    final_asset_id: "asset-1",
    thumbnail_url: "https://cdn/thumb.jpg",
    duration_sec: 30,
    segments: [
      {
        source: "stock",
        provider: "pexels",
        query: "stage lights",
        attribution: "Pexels - https://pexels.example/video",
      },
    ],
    provenance: [{ provider: "pexels", attribution: "Pexels - https://pexels.example/video" }],
    perceptual_hash: null,
    reused_flags: {},
    default_caption: "stage lights edit",
    default_hashtags: ["#music"],
    metadata: {},
    created_at: "2026-05-18T10:00:00.000Z",
    updated_at: "2026-05-18T10:05:00.000Z",
  },
  {
    id: "item-failed",
    account_id: "account-1",
    audio_clip_id: "clip-1",
    batch_id: "batch-1",
    generation_item_id: "generation-2",
    library_index: 1,
    status: "failed",
    final_asset_id: null,
    thumbnail_url: null,
    duration_sec: 30,
    segments: [{ source: "seedance", provider: "seedance", query: "neon rain" }],
    provenance: [],
    perceptual_hash: null,
    reused_flags: {},
    default_caption: "neon rain",
    default_hashtags: [],
    metadata: {},
    created_at: "2026-05-18T10:01:00.000Z",
    updated_at: "2026-05-18T10:06:00.000Z",
  },
];

describe("library UI helpers", () => {
  it("maps library statuses to existing status tones", () => {
    expect(libraryStatusTone("ready")).toBe("good");
    expect(libraryStatusTone("scheduled")).toBe("warn");
    expect(libraryStatusTone("failed")).toBe("bad");
    expect(libraryStatusTone("not_ready")).toBe("idle");
  });

  it("filters by status and segment/caption search text", () => {
    expect(
      filterLibraryItems(items, { status: "unscheduled", query: "" }).map((item) => item.id),
    ).toEqual(["item-ready"]);
    expect(
      filterLibraryItems(items, { status: "all", query: "neon" }).map((item) => item.id),
    ).toEqual(["item-failed"]);
    expect(
      filterLibraryItems(items, { status: "all", query: "pexels.example" }).map((item) => item.id),
    ).toEqual(["item-ready"]);
  });

  it("deduplicates attribution lines from provenance and segments", () => {
    expect(libraryAttributionLines(items[0])).toEqual(["Pexels - https://pexels.example/video"]);
  });

  it("sorts finalized library items by source distinctness before library index", () => {
    const mixedItem: LibraryItem = {
      ...items[0],
      id: "item-mixed",
      library_index: 5,
      segments: [
        { source: "stock", provider: "pexels", externalId: "123" },
        { source: "seedance", provider: "seedance", prompt: "neon stage" },
      ],
      provenance: [
        { source_type: "stock", provider: "pexels", external_id: "123" },
        { source_type: "seedance", provider: "seedance" },
      ],
    };

    expect(libraryDistinctnessScore(mixedItem)).toBe(2);
    expect(
      sortLibraryItemsForDisplay([items[1], mixedItem, items[0]]).map((item) => item.id),
    ).toEqual(["item-mixed", "item-ready", "item-failed"]);
  });

  it("sorts library items by created, next scheduled, and deterministic random modes", () => {
    const scheduledItems: LibraryItem[] = [
      {
        ...items[0],
        id: "later",
        library_index: 2,
        created_at: "2026-05-18T10:02:00.000Z",
        next_scheduled_at: "2026-05-21T10:00:00.000Z",
      },
      {
        ...items[0],
        id: "unscheduled",
        library_index: 1,
        created_at: "2026-05-18T10:01:00.000Z",
        next_scheduled_at: null,
      },
      {
        ...items[0],
        id: "earlier",
        library_index: 0,
        created_at: "2026-05-18T10:00:00.000Z",
        next_scheduled_at: "2026-05-20T10:00:00.000Z",
      },
    ];

    expect(sortLibraryItems(scheduledItems, "created").map((item) => item.id)).toEqual([
      "earlier",
      "unscheduled",
      "later",
    ]);
    expect(sortLibraryItems(scheduledItems, "next_scheduled").map((item) => item.id)).toEqual([
      "earlier",
      "later",
      "unscheduled",
    ]);
    expect(sortLibraryItems(scheduledItems, "random", "seed-a")).toEqual(
      sortLibraryItems(scheduledItems, "random", "seed-a"),
    );
    expect(sortLibraryItems(scheduledItems, "random", "seed-a").map((item) => item.id)).not.toEqual(
      ["earlier", "unscheduled", "later"],
    );
  });

  it("surfaces reused and fallback source markers from library metadata", () => {
    const markedItem: LibraryItem = {
      ...items[0],
      reused_flags: { 0: true },
      segments: [{ source: "stock", provider: "pexels", tolerance_seconds_used: 10 }],
      provenance: [{ provider: "pexels", reused: true }],
    };

    expect(libraryQualityMarkers(markedItem)).toEqual([
      { key: "reused", label: "reused source", tone: "warn" },
      { key: "fallback", label: "10s fallback", tone: "warn" },
    ]);
  });

  it("uses per-segment duration when searching for replacement candidates", () => {
    const multiSegmentItem: LibraryItem = {
      ...items[0],
      duration_sec: 45,
      segments: [
        { source: "stock", durationSec: 14 },
        { source: "stock", duration_seconds: 16 },
        { source: "stock" },
      ],
    };

    expect(librarySegmentTargetDurationSeconds(multiSegmentItem, 0)).toBe(14);
    expect(librarySegmentTargetDurationSeconds(multiSegmentItem, 1)).toBe(16);
    expect(librarySegmentTargetDurationSeconds(multiSegmentItem, 2)).toBe(15);
  });

  it("keeps bulk regenerate scoped to selected rows with generation items", () => {
    expect(selectedRegeneratableIds(items, new Set(["item-ready", "missing"]))).toEqual([
      "generation-1",
    ]);
  });

  it("keeps failed library rows regeneratable even before generation links are repaired", () => {
    const failedWithoutGeneration: LibraryItem = {
      ...items[1],
      id: "item-failed-unlinked",
      generation_item_id: null,
    };

    expect(canRegenerateLibraryItem(failedWithoutGeneration)).toBe(true);
    expect(
      selectedRegeneratableTargets([failedWithoutGeneration], new Set(["item-failed-unlinked"])),
    ).toEqual([{ libraryItemId: "item-failed-unlinked", generationItemId: null }]);
  });

  it("exposes the library sort modes in the grid UI", () => {
    const source = readFileSync("src/components/library/LibraryGrid.tsx", "utf8");

    expect(source).toContain("LibrarySortMode");
    expect(source).toContain("Next scheduled");
    expect(source).toContain("Random");
    expect(source).toContain("setRandomSeed");
  });

  it("keeps segment replacement searches aligned with backend segment duration checks", () => {
    const source = readFileSync("src/components/library/SegmentReplaceDialog.tsx", "utf8");
    const api = readFileSync("src/lib/library/api.ts", "utf8");

    expect(source).toContain("librarySegmentTargetDurationSeconds");
    expect(source).toContain("segment?.sourceType || segment?.source_type || segment?.source");
    expect(source).toContain("libraryItemId: activeTarget.item.id");
    expect(api).toContain('supabase.functions.invoke("source-candidate-replace"');
    expect(api).toContain('action: "searchCandidates"');
    expect(api).not.toContain('supabase.functions.invoke("source-candidate-search"');
    expect(source).not.toContain("targetDurationSec: activeTarget.item.duration_sec");
  });

  it("keeps library scheduling scoped to ready rows with final assets", () => {
    expect(canScheduleLibraryItem(items[0])).toBe(true);
    expect(canScheduleLibraryItem(items[1])).toBe(false);
    expect(selectedSchedulableIds(items, new Set(["item-ready", "item-failed"]))).toEqual([
      "item-ready",
    ]);
  });

  it("builds tile download and copy-caption values from finalized media metadata", () => {
    const item: LibraryItem = {
      ...items[0],
      default_caption: "sound on",
      default_hashtags: ["fyp", "#music"],
      media: {
        id: "asset-1",
        public_url: "https://cdn.example.com/final.mp4",
      },
    };

    expect(libraryDownloadUrl(item)).toBe("https://cdn.example.com/final.mp4");
    expect(libraryDownloadFileName(item)).toBe("fanagent-clip-1.mp4");
    expect(libraryCaptionText(item)).toBe("sound on\n\n#fyp #music");
  });

  it("defaults single item scheduling to thirty minutes from now", () => {
    const now = new Date("2026-05-18T10:00:00.000Z");
    const expected = toLocalScheduleInputValue(new Date(now.getTime() + 30 * 60_000));

    expect(defaultSingleScheduleInput(now)).toBe(expected);
  });

  it("parses single item scheduling input to an ISO timestamp", () => {
    const input = "2026-05-18T10:30";

    expect(parseSingleScheduleInput(input)).toBe(new Date(input).toISOString());
    expect(() => parseSingleScheduleInput("not-a-date")).toThrow("Choose a valid schedule time.");
  });
});
