import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { filterByDuration, filterPortrait } from "../supabase/functions/_shared/sources/filters.ts";
import {
  candidateDedupeKeys,
  hammingDistance,
  selectUnique,
} from "../supabase/functions/_shared/sources/dedupe.ts";
import {
  getSourceAdapter,
  sourceAdapterTypes,
} from "../supabase/functions/_shared/sources/registry.ts";
import type { SourceCandidate } from "../supabase/functions/_shared/sources/types.ts";
import { isAllowedSourceLicense } from "../supabase/functions/_shared/sources/types.ts";

const candidates: SourceCandidate[] = [
  {
    source_type: "stock",
    provider: "pexels",
    external_id: "a",
    origin_url: "https://example.com/a.mp4",
    width: 1080,
    height: 1920,
    duration_seconds: 14,
    is_portrait: true,
    license: "pexels",
    score: 0.9,
  },
  {
    source_type: "stock",
    provider: "pixabay",
    external_id: "b",
    origin_url: "https://example.com/b.mp4",
    width: 1080,
    height: 1920,
    duration_seconds: 23,
    is_portrait: true,
    license: "pixabay",
    score: 0.7,
  },
  {
    source_type: "stock",
    provider: "pexels",
    external_id: "c",
    origin_url: "https://example.com/c.mp4",
    width: 1920,
    height: 1080,
    duration_seconds: 15,
    is_portrait: false,
    license: "pexels",
    score: 0.95,
  },
];

describe("source duration and orientation filters", () => {
  it("returns preferred ±5s matches when available", () => {
    const result = filterByDuration(candidates, 15, 5, 10);

    expect(result.toleranceUsed).toBe(5);
    expect(result.candidates.map((candidate) => candidate.external_id)).toEqual(["c", "a"]);
  });

  it("falls back to ±10s matches when preferred matches are unavailable", () => {
    const result = filterByDuration(candidates, 30, 5, 10);

    expect(result.toleranceUsed).toBe(10);
    expect(result.candidates.map((candidate) => candidate.external_id)).toEqual(["b"]);
  });

  it("returns an empty set when neither duration window matches", () => {
    const result = filterByDuration(candidates, 60, 5, 10);

    expect(result.toleranceUsed).toBe(null);
    expect(result.candidates).toEqual([]);
  });

  it("removes landscape candidates", () => {
    expect(filterPortrait(candidates).map((candidate) => candidate.external_id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("source dedupe selection", () => {
  it("derives provider/id, URL, and perceptual-hash dedupe keys", () => {
    const keys = candidateDedupeKeys({
      ...candidates[0],
      perceptual_hash: "ff00ff00ff00ff00",
    });

    expect(keys).toEqual([
      "provider:stock:pexels:a",
      "url:https://example.com/a.mp4",
      "phash:ff00ff00ff00ff00",
    ]);
  });

  it("computes hamming distance for hex perceptual hashes", () => {
    expect(hammingDistance("ff", "f0")).toBe(4);
    expect(hammingDistance("ff00", "ff00")).toBe(0);
  });

  it("strict mode returns the first unused candidate and null on exhaustion", () => {
    const used = new Set(candidateDedupeKeys(candidates[0]));

    expect(selectUnique(candidates, used, "strict")).toMatchObject({
      candidate: { external_id: "c" },
      reused: false,
    });

    for (const candidate of candidates) {
      for (const key of candidateDedupeKeys(candidate)) used.add(key);
    }

    expect(selectUnique(candidates, used, "strict")).toBeNull();
  });

  it("allow_reuse_after_exhaustion marks reuse only after inventory is exhausted", () => {
    const used = new Set<string>();
    for (const candidate of candidates) {
      for (const key of candidateDedupeKeys(candidate)) used.add(key);
    }

    expect(selectUnique(candidates, used, "allow_reuse_after_exhaustion")).toMatchObject({
      candidate: { external_id: "c" },
      reused: true,
    });
  });

  it("allow_reuse_freely returns the first ranked candidate regardless of use", () => {
    const used = new Set(candidateDedupeKeys(candidates[2]));

    expect(selectUnique(candidates, used, "allow_reuse_freely")).toMatchObject({
      candidate: { external_id: "c" },
      reused: true,
    });
  });
});

describe("source adapter registry", () => {
  it("exposes all AGENTS.md source adapters", () => {
    expect(sourceAdapterTypes).toEqual([
      "stock",
      "library",
      "seedance",
      "gmi_seedance",
      "sports_edit",
      "streamer_clip",
    ]);
    expect(getSourceAdapter("stock").type).toBe("stock");
    expect(getSourceAdapter("streamer_clip").type).toBe("streamer_clip");
  });

  it("keeps source licenses inside the rights contract", () => {
    expect(isAllowedSourceLicense("pexels")).toBe(true);
    expect(isAllowedSourceLicense("youtube_owner_provided")).toBe(true);
    expect(isAllowedSourceLicense("twitch_creator_rights")).toBe(true);
    expect(isAllowedSourceLicense("youtube_standard")).toBe(false);
  });

  it("carries selected candidate rights metadata into generation segments", () => {
    const source = readFileSync("supabase/functions/pick-stock-clip/index.ts", "utf8");

    expect(source).toContain("sourceType: input.candidate.source_type");
    expect(source).toContain("license: input.candidate.license");
    expect(source).toContain("rightsHolder: input.candidate.rights_holder ?? null");
    expect(source).toContain("attribution: input.candidate.attribution ?? null");
    expect(source).toContain(
      "storagePath: input.storagePath ?? input.candidate.storage_path ?? null",
    );
    expect(source).toContain("storagePath: cached.storage_path");
  });
});
