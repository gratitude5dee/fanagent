import { describe, it, expect } from "vitest";
import { resyncOnWordsChange, type WordKey } from "@/lib/lyrics/markers";

const w = (id: string, s: number, e: number): WordKey => ({ id, startTime: s, endTime: e });

describe("resyncOnWordsChange", () => {
  it("drops the nearest marker inside a removed word's window", () => {
    const prev = [w("a", 0, 0.5), w("b", 1, 1.5), w("c", 2, 2.5)];
    const next = [w("a", 0, 0.5), w("c", 2, 2.5)];
    const markers = [0.2, 1.2, 2.3];
    const out = resyncOnWordsChange(prev, next, markers);
    expect(out).toEqual([0.2, 2.3]);
  });

  it("inserts a marker at an added word's start (snapped/deduped)", () => {
    const prev = [w("a", 0, 0.5)];
    const next = [w("a", 0, 0.5), w("b", 1.234, 1.6)];
    const out = resyncOnWordsChange(prev, next, [0.2]);
    expect(out).toContain(0.2);
    // addMarker snaps to 0.05 increments
    expect(out.some((m) => Math.abs(m - 1.25) < 1e-9)).toBe(true);
  });

  it("preserves manually placed markers far from any word window", () => {
    const prev = [w("a", 0, 0.4)];
    const next: WordKey[] = [];
    const manual = 8.0;
    const out = resyncOnWordsChange(prev, next, [0.2, manual]);
    expect(out).toEqual([manual]);
  });
});
