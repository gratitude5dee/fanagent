import React from "react";
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  SUPABASE_URL: "https://example.supabase.co",
  supabase: {},
}));

vi.mock("@/components/autopilot/LyricsTemplateBuilder", () => ({
  default: function MockLyricsTemplateBuilder() {
    return null;
  },
}));

vi.mock("@/lib/lyrics/api", () => ({
  lyricsApi: {
    archive: vi.fn(),
  },
}));

import { LyricsStep } from "../src/components/autopilot/LyricsStep";
import type { LyricTemplateSummary } from "../src/lib/lyrics/types";

function renderLyricsStep(template: LyricTemplateSummary): string {
  return renderToString(
    React.createElement(LyricsStep, {
      lyricTemplateId: template.id,
      lyricTemplates: [template],
      drawerOpen: false,
      onDrawerOpen: vi.fn(),
      onTemplate: vi.fn(),
      onTemplatesChanged: vi.fn(),
      autoOpenTemplateRequest: 0,
    }),
  );
}

describe("Autopilot lyrics handoff", () => {
  it("prioritizes reviewing the generated in-progress template over starting blank", () => {
    const html = renderLyricsStep({
      id: "template-generated",
      title: "Uploaded song lyrics",
      status: "lyrics_ready",
      total_duration_ms: 30000,
      selection_duration_ms: 30000,
      updated_at: "2026-05-20T04:30:00.000Z",
    });

    expect(html).toContain("Review generated template");
    expect(html).toContain("New blank template");
    expect(html).toContain("Uploaded song lyrics");
  });

  it("keeps saved templates on the normal new/edit affordance", () => {
    const html = renderLyricsStep({
      id: "template-saved",
      title: "Saved lyrics",
      status: "saved",
      total_duration_ms: 30000,
      selection_duration_ms: 30000,
      updated_at: "2026-05-20T04:30:00.000Z",
    });

    expect(html).toContain("New template");
    expect(html).toContain("Edit selected");
    expect(html).not.toContain("Review generated template");
  });

  it("wires the auto-created template request from Autopilot into the inline builder", () => {
    const panelSource = readFileSync("src/components/AutopilotPanel.tsx", "utf8");
    const stepSource = readFileSync("src/components/autopilot/LyricsStep.tsx", "utf8");
    const builderSource = readFileSync(
      "src/components/autopilot/LyricsTemplateBuilder.tsx",
      "utf8",
    );

    expect(panelSource).toContain("setAutoOpenTemplateRequest((request) => request + 1)");
    expect(panelSource).toContain("autoOpenTemplateRequest={autoOpenTemplateRequest}");
    expect(stepSource).toContain("Review generated template");
    expect(stepSource).toContain("if (lyricTemplateId) openBuilder(lyricTemplateId)");
    expect(builderSource).toContain("audioClipIdFromTemplate");
    expect(builderSource).toContain("lyricsApi.createFromAudioClip({ audioClipId })");
  });
});
