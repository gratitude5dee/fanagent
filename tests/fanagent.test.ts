import { describe, expect, it } from "vitest";
import { findGmiVideoUrl } from "../src/lib/fanagent/gmi";
import { createPromptPlan } from "../src/lib/fanagent/prompt";
import { buildSchedule } from "../src/lib/fanagent/schedule";
import {
  buildDirectPostInitBody,
  createChunkPlan,
  parseTikTokStatusResponse,
} from "../src/lib/fanagent/tiktok";

describe("schedule generation", () => {
  it("builds bounded schedules from a start date and cadence", () => {
    const start = new Date("2026-05-10T12:00:00.000Z");
    const schedule = buildSchedule(start, 3, 30);

    expect(schedule.map((date) => date.toISOString())).toEqual([
      "2026-05-10T12:00:00.000Z",
      "2026-05-10T12:30:00.000Z",
      "2026-05-10T13:00:00.000Z",
    ]);
  });

  it("clamps count and cadence to hosted v1 limits", () => {
    const schedule = buildSchedule(new Date("2026-05-10T12:00:00.000Z"), 100, 1);

    expect(schedule).toHaveLength(50);
    expect(schedule[1].getTime() - schedule[0].getTime()).toBe(5 * 60_000);
  });
});

describe("prompt generation", () => {
  it("emits SCLCAM-style vertical prompts with safe social-video constraints", () => {
    const plan = createPromptPlan({
      basePrompt: "stage lights and a packed venue",
      index: 0,
      total: 2,
    });

    expect(plan.prompt).toContain("9:16 aspect ratio");
    expect(plan.prompt).toContain("no logos or watermarks");
    expect(plan.videoPrompt.duration_seconds).toBe(15);
    expect(plan.caption).toContain("stage lights");
  });
});

describe("GMI parsing", () => {
  it("finds video artifacts in nested outcomes", () => {
    const url = findGmiVideoUrl({
      outcome: {
        artifacts: [
          { thumbnail: "https://example.com/image.jpg" },
          { video_url: "https://cdn.example.com/final.mp4" },
        ],
      },
    });

    expect(url).toBe("https://cdn.example.com/final.mp4");
  });
});

describe("TikTok request helpers", () => {
  it("builds FILE_UPLOAD chunks and Direct Post init bodies", () => {
    const body = buildDirectPostInitBody(
      {
        title: "sound on #music",
        privacyLevel: "SELF_ONLY",
        disableDuet: true,
        disableComment: false,
        disableStitch: true,
        isAigc: true,
        brandContentToggle: false,
        brandOrganicToggle: false,
      },
      24 * 1024 * 1024,
    );

    expect(createChunkPlan(24 * 1024 * 1024)).toEqual({
      chunkSize: 10 * 1024 * 1024,
      totalChunkCount: 3,
    });
    expect(body).toMatchObject({
      post_info: {
        privacy_level: "SELF_ONLY",
        is_aigc: true,
      },
      source_info: {
        source: "FILE_UPLOAD",
        total_chunk_count: 3,
      },
    });
  });

  it("parses publish status responses and rejects TikTok errors", () => {
    expect(
      parseTikTokStatusResponse(
        JSON.stringify({
          data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["123"] },
          error: { code: "ok", message: "" },
        }),
      ).status,
    ).toBe("PUBLISH_COMPLETE");

    expect(() =>
      parseTikTokStatusResponse(
        JSON.stringify({
          error: { code: "invalid_publish_id", message: "bad id" },
        }),
      ),
    ).toThrow("invalid_publish_id");
  });
});
