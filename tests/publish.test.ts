import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyTikTokPublishError,
  getTikTokPublishBlock,
  TikTokPublishBlockedError,
} from "../supabase/functions/_shared/tiktok.ts";

describe("TikTok publish blocking", () => {
  it("blocks missing videos before calling TikTok", () => {
    expect(
      getTikTokPublishBlock({
        video_url: null,
        tiktok_privacy_level: "SELF_ONLY",
      }),
    ).toEqual({
      publishStatus: "blocked_missing_video",
      message: "Post is missing a final video URL.",
    });
  });

  it("blocks missing privacy before calling TikTok", () => {
    expect(
      getTikTokPublishBlock({
        video_url: "https://cdn.example.com/final.mp4",
        tiktok_privacy_level: null,
      }),
    ).toEqual({
      publishStatus: "blocked_missing_privacy",
      message: "Choose a TikTok privacy level before publishing.",
    });
  });

  it("classifies creator restrictions as blocked instead of failed", () => {
    const error = new TikTokPublishBlockedError(
      "Selected TikTok privacy level is not available for this creator.",
      "blocked_creator_restriction",
    );

    expect(classifyTikTokPublishError(error)).toEqual({
      kind: "blocked",
      publishStatus: "blocked_creator_restriction",
      message: "Selected TikTok privacy level is not available for this creator.",
    });
  });

  it("wires the cron wrapper to rescan blocked posts every 30 minutes", () => {
    const wrapper = readFileSync("supabase/functions/fanpage-publish-due/index.ts", "utf8");
    const worker = readFileSync("supabase/functions/publish-tiktok-due/index.ts", "utf8");

    expect(wrapper).toContain("rescanBlockedMinutes: 30");
    expect(worker).toContain("isBlockedPublishStatus");
    expect(worker).toContain("blockedRescanCutoff");
  });
});
