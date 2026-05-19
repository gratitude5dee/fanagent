import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blocksToSrt,
  transcriptToKanvasLyricBlocks,
} from "../supabase/functions/_shared/lyrics.ts";

describe("FanAgent lyric template handoff", () => {
  it("converts audio-clip transcripts into editable Kanvas lyric blocks", () => {
    const blocks = transcriptToKanvasLyricBlocks({
      language: "eng",
      text: "lights up",
      words: [
        { text: "lights", start: 0.12, end: 0.5 },
        { text: "up", start: 0.55, end: 0.9 },
      ],
    });

    expect(blocks).toEqual([
      {
        id: "block-1",
        label: "Line 1",
        startTime: 0.12,
        endTime: 0.9,
        words: [
          { id: "word-1", text: "lights", startTime: 0.12, endTime: 0.5 },
          { id: "word-2", text: "up", startTime: 0.55, endTime: 0.9 },
        ],
      },
    ]);
  });

  it("renders SRT from existing seconds-based Kanvas blocks", () => {
    const srt = blocksToSrt(
      [
        {
          id: "block-1",
          label: "Line 1",
          startTime: 1.25,
          endTime: 2.75,
          words: [
            { id: "word-1", text: "we", startTime: 1.25, endTime: 1.5 },
            { id: "word-2", text: "rise", startTime: 1.6, endTime: 2.75 },
          ],
        },
      ],
      1000,
      15,
    );

    expect(srt).toContain("00:00:00,250 --> 00:00:01,750");
    expect(srt).toContain("we rise");
  });

  it("still renders SRT from millisecond-based transcript blocks", () => {
    const srt = blocksToSrt(
      [
        {
          id: "block-1",
          text: "sound on",
          startMs: 300,
          endMs: 1200,
          words: [],
        },
      ],
      0,
      15,
    );

    expect(srt).toContain("00:00:00,300 --> 00:00:01,200");
    expect(srt).toContain("sound on");
  });

  it("adds the createFromAudioClip template action", () => {
    const source = readFileSync("supabase/functions/kanvas-lyrics-template/index.ts", "utf8");

    expect(source).toContain('case "createFromAudioClip"');
    expect(source).toContain("default_lyric_template_id");
    expect(source).toContain("transcriptToKanvasLyricBlocks");
  });

  it("keeps lyrics frontend calls compatible with envelope-shaped edge responses", () => {
    const source = readFileSync("src/lib/lyrics/api.ts", "utf8");

    expect(source).toContain("type FunctionEnvelope<T>");
    expect(source).toContain("function unwrapFunctionData<T>");
    expect(source).toContain("if (data) return unwrapFunctionData<T>(data)");
    expect(source).toContain("return unwrapFunctionData<T>(data)");
  });

  it("keeps Kanvas lyrics edge functions on the shared envelope contract", () => {
    const template = readFileSync("supabase/functions/kanvas-lyrics-template/index.ts", "utf8");
    const transcribe = readFileSync("supabase/functions/kanvas-lyrics-transcribe/index.ts", "utf8");
    const audioRegister = readFileSync(
      "supabase/functions/kanvas-lyrics-audio-register/index.ts",
      "utf8",
    );

    for (const source of [template, transcribe, audioRegister]) {
      expect(source).toContain("import { errorEnvelope, okEnvelope }");
      expect(source).toContain('errorEnvelope("Method not allowed", "METHOD_NOT_ALLOWED", 405)');
      expect(source).toContain("okEnvelope({");
      expect(source).not.toContain("jsonResponse({");
      expect(source).not.toContain("return errorResponse(e)");
    }
    expect(template).toContain('"KANVAS_LYRICS_TEMPLATE_FAILED"');
    expect(transcribe).toContain('"TEMPLATE_ID_REQUIRED"');
    expect(transcribe).toContain('"KANVAS_LYRICS_TRANSCRIBE_FAILED"');
    expect(audioRegister).toContain('"AUDIO_REGISTER_REQUEST_INVALID"');
    expect(audioRegister).toContain('"KANVAS_LYRICS_AUDIO_REGISTER_FAILED"');
  });
});
