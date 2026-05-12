import { describe, expect, it } from "vitest";
import { findGmiVideoUrl } from "../src/lib/fanagent/gmi";
import { createPromptPlan } from "../src/lib/fanagent/prompt";
import { buildSchedule } from "../src/lib/fanagent/schedule";
import {
  normalizeSourceMode,
  sourceModeNeedsFal,
  sourceModeNeedsGmi,
} from "../src/lib/fanagent/sourceMode";
import {
  buildDirectPostInitBody,
  createChunkPlan,
  isTikTokPrivacyLevelAllowed,
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

  it("clamps count and cadence to campaign limits", () => {
    const schedule = buildSchedule(new Date("2026-05-10T12:00:00.000Z"), 999, 1);

    expect(schedule).toHaveLength(250);
    expect(schedule[1].getTime() - schedule[0].getTime()).toBe(5 * 60_000);
  });
});

describe("source mode normalization", () => {
  it("normalizes legacy and invalid source modes", () => {
    expect(normalizeSourceMode("hybrid")).toBe("mixed");
    expect(normalizeSourceMode("seedance")).toBe("seedance");
    expect(normalizeSourceMode("remote_render")).toBe("stock");
  });

  it("classifies provider requirements", () => {
    expect(sourceModeNeedsFal("mixed")).toBe(true);
    expect(sourceModeNeedsFal("stock")).toBe(false);
    expect(sourceModeNeedsGmi("gmi_seedance")).toBe(true);
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

  it("propagates longer video durations into generation prompts", () => {
    const plan = createPromptPlan({
      basePrompt: "night market performance",
      index: 1,
      total: 4,
      durationSeconds: 90,
    });

    expect(plan.prompt).toContain("90 seconds");
    expect(plan.videoPrompt.duration_seconds).toBe(90);
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

  it("validates privacy levels against creator options", () => {
    expect(
      isTikTokPrivacyLevelAllowed("SELF_ONLY", {
        privacy_level_options: ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS"],
      }),
    ).toBe(true);
    expect(
      isTikTokPrivacyLevelAllowed("PUBLIC_TO_EVERYONE", {
        privacy_level_options: ["SELF_ONLY"],
      }),
    ).toBe(false);
    expect(isTikTokPrivacyLevelAllowed(null, {})).toBe(false);
  });
});
