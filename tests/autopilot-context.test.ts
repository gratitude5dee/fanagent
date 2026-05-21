import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  SUPABASE_URL: "https://example.supabase.co",
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

import { buildCampaignHandoff } from "../src/pages/autopilot/handoff";
import type { RegisteredAudioClipSummary } from "../src/lib/fanagent/audioClip";
import type { LyricTemplateSummary } from "../src/lib/lyrics/types";

const clip: RegisteredAudioClipSummary = {
  id: "clip-1",
  duration_sec: 30,
  file_name: "hook.wav",
  transcription_status: "ready",
  selection_start_sec: 0,
  selection_end_sec: 30,
};

const savedTemplate: LyricTemplateSummary = {
  id: "template-1",
  title: "Saved",
  status: "saved",
  audio_clip_id: "clip-1",
  trimmed_audio_asset_id: "asset-1",
  total_duration_ms: 30_000,
  selection_duration_ms: 30_000,
  word_count: 10,
  cut_marker_count: 2,
  updated_at: "2026-05-20T00:00:00.000Z",
};

describe("AutopilotContext campaign handoff", () => {
  it("marks the handoff ready only for saved templates bound to the selected audio", () => {
    expect(
      buildCampaignHandoff({
        lyricTemplateId: savedTemplate.id,
        registeredAudioClip: clip,
        selectedTemplate: savedTemplate,
        trimmedAudio: null,
      }),
    ).toMatchObject({
      ready: true,
      templateSaved: true,
      templateMatchesAudio: true,
      audioClipId: "clip-1",
      trimmedAudioAssetId: "asset-1",
    });

    expect(
      buildCampaignHandoff({
        lyricTemplateId: savedTemplate.id,
        registeredAudioClip: { ...clip, id: "clip-other" },
        selectedTemplate: savedTemplate,
        trimmedAudio: null,
      }).ready,
    ).toBe(false);

    expect(
      buildCampaignHandoff({
        lyricTemplateId: "template-draft",
        registeredAudioClip: clip,
        selectedTemplate: { ...savedTemplate, id: "template-draft", status: "draft" },
        trimmedAudio: null,
      }).ready,
    ).toBe(false);

    expect(
      buildCampaignHandoff({
        lyricTemplateId: savedTemplate.id,
        registeredAudioClip: clip,
        selectedTemplate: { ...savedTemplate, trimmed_audio_asset_id: null },
        trimmedAudio: null,
      }).ready,
    ).toBe(false);
  });
});
