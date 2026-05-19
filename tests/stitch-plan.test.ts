import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeCutMarkersMs,
  segmentDurationsFromCutMarkers,
} from "../supabase/functions/_shared/stitch-plan.ts";

describe("marker-driven stitch planning", () => {
  it("normalizes numeric lyric cut markers", () => {
    expect(normalizeCutMarkersMs([15000, "5000", 15000, -1, "nope", 10000.4])).toEqual([
      5000, 10000, 15000,
    ]);
  });

  it("uses lyric cut markers closest to the generated segment boundaries", () => {
    expect(
      segmentDurationsFromCutMarkers({
        cutMarkersMs: [5000, 14500, 21000, 26000],
        segmentCount: 3,
        totalSeconds: 30,
      }),
    ).toEqual([14.5, 6.5, 9]);
  });

  it("falls back to even stitch timing when there are not enough usable markers", () => {
    expect(
      segmentDurationsFromCutMarkers({
        cutMarkersMs: [0, 30000],
        segmentCount: 3,
        totalSeconds: 30,
      }),
    ).toBeNull();
  });

  it("keeps stitch-segments on marker compose when lyric markers are available", () => {
    const source = readFileSync("supabase/functions/stitch-segments/index.ts", "utf8");

    expect(source).toContain("segmentDurationsFromCutMarkers");
    expect(source).toContain("composeClipsWithAudio");
    expect(source).toContain('stitchMode: "marker_compose"');
    expect(source).toContain('stitch_timing: markerTiming ? "cut_markers" : "even_split"');
    expect(source).toContain('render.stitchMode === "marker_compose"');
  });
});
