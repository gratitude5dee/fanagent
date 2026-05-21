import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSourceOptions } from "../src/lib/fanagent/sourceMode";

describe("Autopilot wizard structure", () => {
  it("uses stepped components and exposes gated adapter modes", () => {
    const connectPage = readFileSync("src/pages/autopilot/steps/ConnectPage.tsx", "utf8");
    const uploadPage = readFileSync("src/pages/autopilot/steps/UploadPage.tsx", "utf8");
    const lyricsPage = readFileSync("src/pages/autopilot/steps/LyricsPage.tsx", "utf8");
    const campaignPage = readFileSync("src/pages/autopilot/steps/CampaignPage.tsx", "utf8");
    const context = readFileSync("src/pages/autopilot/AutopilotContext.tsx", "utf8");

    expect(connectPage).toContain("ConnectStep");
    expect(uploadPage).toContain("UploadStep");
    expect(lyricsPage).toContain("LyricsStep");
    expect(campaignPage).toContain("CampaignStep");
    expect(context).toContain("isFanAgentSchemaReady(diagnostics?.schema)");

    const options = buildSourceOptions({
      fal: true,
      gmi: true,
      youtubeApiKey: true,
      sportsAllowed: true,
      twitchClientId: true,
      twitchClientSecret: true,
      streamerAllowed: true,
    });
    expect(options.map((option) => option.value)).toContain("sports_edit");
    expect(options.map((option) => option.value)).toContain("streamer_clip");

    const campaignStep = readFileSync("src/components/autopilot/CampaignStep.tsx", "utf8");
    expect(campaignStep).toContain("disabled={option.disabled}");
    expect(campaignStep).toContain('props.sourceMode === "sports_edit"');
    expect(campaignStep).toContain("Owner MP4 asset URLs");
    expect(campaignStep).toContain("props.sportsOwnerAssetUrls");
    expect(campaignStep).toContain('props.sourceMode === "streamer_clip"');
    expect(context).toContain("sourceSettings: {");
    expect(context).toContain("sports_edit: {");
    expect(context).toContain("ownerAssetUrls: parseKeyValueLines(sportsOwnerAssetUrls)");
    expect(context).toContain("streamer_clip: {");
  });

  it("allows campaign-level source allowlists when provider credentials exist", () => {
    const options = buildSourceOptions({
      youtubeApiKey: true,
      sportsAllowed: false,
      twitchClientId: true,
      twitchClientSecret: true,
      streamerAllowed: false,
    });

    expect(options.find((option) => option.value === "sports_edit")).toMatchObject({
      disabled: false,
    });
    expect(options.find((option) => option.value === "streamer_clip")).toMatchObject({
      disabled: false,
    });
  });

  it("auto-opens the lyric review drawer after a trimmed clip is ready", () => {
    const context = readFileSync("src/pages/autopilot/AutopilotContext.tsx", "utf8");
    const lyricsStep = readFileSync("src/components/autopilot/LyricsStep.tsx", "utf8");

    expect(context).toContain("setLyricsDrawerOpen(true)");
    expect(lyricsStep).toContain("lyrics-drawer");
  });

  it("registers trimmed audio clips before campaign creation", () => {
    const context = readFileSync("src/pages/autopilot/AutopilotContext.tsx", "utf8");
    const uploadStep = readFileSync("src/components/autopilot/UploadStep.tsx", "utf8");
    const campaignStep = readFileSync("src/components/autopilot/CampaignStep.tsx", "utf8");
    const campaignPage = readFileSync("src/pages/autopilot/steps/CampaignPage.tsx", "utf8");

    expect(context).toContain("registerAudioClip({");
    expect(context).toContain("transcribeAudioClip(registered.audio_clip.id)");
    expect(context).toContain("lyricsApi.createFromAudioClip({");
    expect(context).toContain("audioClipId: registeredClip.id");
    expect(context).toContain("Review and save a lyric template before launching.");
    expect(campaignPage).toContain("lyricTemplateReady={!!ctx.lyricTemplateId}");
    expect(campaignStep).toContain("!props.lyricTemplateReady");
    expect(context).not.toContain("audioBase64: await blobToBase64(trimmedAudio.blob)");
    expect(uploadStep).toContain('audioClipStatus === "transcribing"');
    expect(uploadStep).toContain("You must have rights to publish this audio.");
  });

  it("exposes recovery for failed generation items surfaced by diagnostics", () => {
    const context = readFileSync("src/pages/autopilot/AutopilotContext.tsx", "utf8");
    const connectPage = readFileSync("src/pages/autopilot/steps/ConnectPage.tsx", "utf8");

    expect(context).toContain("const recoverRecentFailures = useCallback(async () =>");
    expect(context).toContain('callCampaign("recoverRecentFailures"');
    expect(connectPage).toContain("ctx.diagnostics.recentFailedItems.length > 0");
    expect(connectPage).toContain("Recent failed generation items");
    expect(connectPage).toContain("> Recover");
  });
});
