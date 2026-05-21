import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createRegenerationReset,
  validateTemplateForRender,
} from "../supabase/functions/_shared/generation.ts";

const renderableTemplate = {
  status: "saved",
  trimmed_audio_asset_id: "asset-1",
  lyric_blocks: [{ id: "block-1", words: [{ text: "hook" }] }],
};

describe("regenerate lyric template guard", () => {
  it("accepts a saved template with audio and lyric blocks", () => {
    expect(validateTemplateForRender(renderableTemplate)).toEqual({ ok: true });
  });

  it("rejects non-saved templates, empty blocks, and missing trimmed audio", () => {
    expect(validateTemplateForRender({ ...renderableTemplate, status: "lyrics_ready" })).toEqual({
      ok: false,
      code: "LYRIC_TEMPLATE_NOT_RENDERABLE",
      message: "Selected lyric template must be saved before it can render.",
    });
    expect(validateTemplateForRender({ ...renderableTemplate, lyric_blocks: [] })).toEqual({
      ok: false,
      code: "LYRIC_TEMPLATE_NOT_RENDERABLE",
      message:
        "Selected lyric template has no transcribed blocks. Open Lyrics and re-save the template.",
    });
    expect(
      validateTemplateForRender({ ...renderableTemplate, trimmed_audio_asset_id: null }),
    ).toEqual({
      ok: false,
      code: "LYRIC_TEMPLATE_NOT_RENDERABLE",
      message:
        "Selected lyric template is missing its trimmed audio asset. Open Lyrics and re-save the template.",
    });
  });

  it("does not clear lyric_template_id in the regeneration reset shape", () => {
    const reset = createRegenerationReset("2026-05-20T00:00:00.000Z");

    expect(reset).toMatchObject({
      status: "pending",
      locked_at: null,
      locked_by: null,
      error_message: null,
    });
    expect(reset).not.toHaveProperty("lyric_template_id");
  });

  it("allows regenerate to resolve generation rows from library item ids", () => {
    const source = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");

    expect(source).toContain("libraryItemId");
    expect(source).toContain("resolveRegenerationTarget");
    expect(source).toContain("findGenerationItemForLibrary");
    expect(source).toContain("generationItemId: itemId");
    expect(source).toContain('status: "pending"');
  });

  it("starts the generation worker after auto-render campaign creation", () => {
    const source = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");

    expect(source).toContain("record(data.batch).auto_render === true");
    expect(source).toContain("waitUntilBackground");
    expect(source).toContain("pumpGenerationWorkers({");
    expect(source).toContain("batchId");
  });
});
