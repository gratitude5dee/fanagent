import { describe, expect, it } from "vitest";
import {
  filterLibraryItems,
  libraryStatusTone,
  selectedRegeneratableIds,
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
    segments: [{ source: "stock", provider: "pexels", query: "stage lights" }],
    provenance: [],
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
      filterLibraryItems(items, { status: "ready", query: "" }).map((item) => item.id),
    ).toEqual(["item-ready"]);
    expect(
      filterLibraryItems(items, { status: "all", query: "neon" }).map((item) => item.id),
    ).toEqual(["item-failed"]);
  });

  it("keeps bulk regenerate scoped to selected rows with generation items", () => {
    expect(selectedRegeneratableIds(items, new Set(["item-ready", "missing"]))).toEqual([
      "generation-1",
    ]);
  });
});
