import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("render-karaoke lyric block guard", () => {
  it("fails instead of silently passthrough when a selected template has no blocks", () => {
    const source = readFileSync("supabase/functions/render-karaoke/index.ts", "utf8");

    expect(source).toContain('"LYRIC_TEMPLATE_BLOCKS_MISSING"');
    expect(source).toContain("Selected lyric template has no transcribed blocks");
    expect(source).toContain("if (!lt.data || blocks.length === 0)");
    expect(source).toContain('status: "failed"');
    expect(source).toContain("throw lyricTemplateBlocksMissing()");
  });
});
