import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Autopilot wizard structure", () => {
  it("uses stepped components and exposes gated adapter modes", () => {
    const panel = readFileSync("src/components/AutopilotPanel.tsx", "utf8");

    expect(panel).toContain("ConnectStep");
    expect(panel).toContain("UploadStep");
    expect(panel).toContain("LyricsStep");
    expect(panel).toContain("CampaignStep");

    const campaignStep = readFileSync("src/components/autopilot/CampaignStep.tsx", "utf8");
    expect(campaignStep).toContain("sports_edit");
    expect(campaignStep).toContain("streamer_clip");
    expect(campaignStep).toContain("disabled={option.disabled}");
  });

  it("auto-opens the lyric review drawer after a trimmed clip is ready", () => {
    const panel = readFileSync("src/components/AutopilotPanel.tsx", "utf8");
    const lyricsStep = readFileSync("src/components/autopilot/LyricsStep.tsx", "utf8");

    expect(panel).toContain("setLyricsDrawerOpen(true)");
    expect(lyricsStep).toContain("lyrics-drawer");
  });
});
