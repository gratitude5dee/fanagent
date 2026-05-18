import { readFileSync } from "node:fs";
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
import { isFalIdleTimeout } from "../supabase/functions/_shared/fal.ts";
import {
  buildBatchSettings,
  buildGenerationItemInputPayload,
  collectUsedStockKeys,
  createRegenerationReset,
  createSegmentVisualPlan,
  normalizeClipSelection,
  selectStockCandidate,
} from "../supabase/functions/_shared/generation.ts";

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
    expect(normalizeSourceMode("sports_edit")).toBe("sports_edit");
    expect(normalizeSourceMode("streamer_clip")).toBe("streamer_clip");
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

  it("covers every allowed campaign duration in generation prompts", () => {
    const durations = [15, 30, 45, 60, 75, 90] as const;

    for (const durationSeconds of durations) {
      const plan = createPromptPlan({
        basePrompt: "night market performance",
        index: durationSeconds,
        total: durations.length,
        durationSeconds,
      });

      expect(plan.prompt).toContain(`${durationSeconds} seconds`);
      expect(plan.videoPrompt.duration_seconds).toBe(durationSeconds);
    }
  });
});

describe("visual diversity planning", () => {
  it("prefers unused stock candidates, then marks reuse after inventory is exhausted", () => {
    const candidates = [
      {
        provider: "pexels",
        externalId: "clip-a",
        url: "https://cdn.example.com/a.mp4",
        score: 0.99,
      },
      {
        provider: "pixabay",
        externalId: "clip-b",
        url: "https://cdn.example.com/b.mp4",
        score: 0.9,
      },
    ];
    const used = collectUsedStockKeys([
      {
        segments: [
          {
            source: "stock",
            provider: "pexels",
            externalId: "clip-a",
            url: "https://cdn.example.com/a.mp4",
          },
        ],
      },
    ]);

    const firstPick = selectStockCandidate(candidates, used);
    expect(firstPick).toMatchObject({
      candidate: { externalId: "clip-b" },
      reused: false,
    });

    used.add("pixabay:clip-b");
    used.add("https://cdn.example.com/b.mp4");
    const exhaustedPick = selectStockCandidate(candidates, used);
    expect(exhaustedPick).toMatchObject({
      candidate: { externalId: "clip-a" },
      reused: true,
    });
  });

  it("varies stock queries and Seedance prompts across items with the same base prompt", () => {
    const plans = Array.from({ length: 12 }, (_, index) =>
      createSegmentVisualPlan({
        basePrompt: "stage lights and a packed venue",
        itemIndex: index,
        segmentIndex: 0,
        transcriptContext: "we go higher every night",
      }),
    );

    expect(new Set(plans.map((plan) => plan.query)).size).toBe(plans.length);
    expect(new Set(plans.map((plan) => plan.prompt)).size).toBe(plans.length);
    expect(plans[0].prompt).toContain("post 1, segment 1");
    expect(plans[1].prompt).toContain("post 2, segment 1");
  });

  it("builds a clean regeneration reset for stale visual fields", () => {
    const reset = createRegenerationReset("2026-05-13T12:00:00.000Z");

    expect(reset).toMatchObject({
      status: "pending",
      segments: null,
      stock_clip_url: null,
      final_asset_id: null,
      render_provider: null,
      post_id: null,
      provider_request_id: null,
      error_message: null,
      stage_events: [],
      updated_at: "2026-05-13T12:00:00.000Z",
    });
  });

  it("carries selected audio clip metadata into batch settings and item payloads", () => {
    const clipSelection = normalizeClipSelection(
      {
        startSec: 4.3219,
        endSec: 19.789,
        durationSec: 15.467,
        originalFileName: "hook.wav",
      },
      15,
    );

    const settings = buildBatchSettings({
      stockSettings: { avoidReuseWithinBatch: true },
      seedanceSettings: { resolution: "720p" },
      clipSelection,
    });
    const payload = buildGenerationItemInputPayload({
      sourceMode: "stock",
      promptPlan: { prompt: "vertical edit" },
      audioAssetId: "audio-asset-1",
      durationSeconds: 15,
      stockSettings: { allowReuseWhenExhausted: true },
      seedanceSettings: {},
      publishDefaults: { privacyLevel: "SELF_ONLY" },
      clipSelection,
      audioClipId: "audio-clip-1",
      libraryItemId: "library-item-1",
      durationTolerance: { preferredSeconds: 5, fallbackSeconds: 10 },
    });

    expect(clipSelection).toEqual({
      startSec: 4.322,
      endSec: 19.789,
      durationSec: 15.467,
      originalFileName: "hook.wav",
    });
    expect(settings.clipSelection).toEqual(clipSelection);
    expect(payload.clip_selection).toEqual(clipSelection);
    expect(payload.audio_asset_id).toBe("audio-asset-1");
    expect(payload.audio_clip_id).toBe("audio-clip-1");
    expect(payload.library_item_id).toBe("library-item-1");
    expect(payload.duration_tolerance).toEqual({ preferred_seconds: 5, fallback_seconds: 10 });
  });
});

describe("generation reliability fixes", () => {
  it("keeps browser audio trimming off ffmpeg.wasm core imports", () => {
    const source = readFileSync("src/lib/audio/ffmpeg.ts", "utf8");

    expect(source).not.toContain("@ffmpeg/ffmpeg");
    expect(source).not.toContain("ffmpeg-core.js");
    expect(source).toContain("audio/wav");
  });

  it("classifies fal and Supabase idle timeouts as retryable stitch failures", () => {
    expect(
      isFalIdleTimeout(
        new Error(
          'stitch-segments failed [504]: {"code":"IDLE_TIMEOUT","message":"Request idle timeout limit (150s) reached"}',
        ),
      ),
    ).toBe(true);
  });

  it("pins Vite dev React chunks to one runtime identity", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const viteConfig = readFileSync("vite.config.ts", "utf8");

    expect(app).toContain('import AutopilotPanel from "@/components/AutopilotPanel"');
    expect(app).not.toContain('lazy(() => import("@/components/AutopilotPanel"))');
    expect(viteConfig).toContain('dedupe: ["react", "react-dom"]');
    expect(viteConfig).toContain("node_modules/react");
    expect(viteConfig).toContain("node_modules/react-dom");
    expect(viteConfig).toContain('"react-dom/client"');
  });

  it("keeps persisted publish statuses aligned with the schema enum", () => {
    const publishSource = readFileSync("supabase/functions/publish-tiktok-due/index.ts", "utf8");
    const campaignSource = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");

    expect(publishSource).not.toContain("publish_status: data.status");
    expect(publishSource).toContain('publish_status: "publish_complete"');
    expect(publishSource).toContain('publish_status: "processing"');
    expect(campaignSource).not.toContain('publish_status: "regenerated"');
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
