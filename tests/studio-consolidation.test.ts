import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  useStudioData: vi.fn(),
}));

vi.mock("@/components/FanAgentCalendar", () => ({
  default: () => React.createElement("div", null, "Mock FanAgent Calendar"),
}));

vi.mock("@/integrations/supabase/client", () => ({
  SUPABASE_URL: "https://example.supabase.co",
  supabase: {},
}));

vi.mock("@/lib/studio/useStudioData", () => ({
  useStudioData: mocks.useStudioData,
}));

import App from "../src/App";
import { autopilotRedirectPath } from "../src/lib/routes";
import { readInitialAppQuery } from "../src/lib/studio/initialAppQuery";

const emptyStudioData = {
  accounts: [],
  posts: [],
  libraryItems: [],
  libraryPreviews: [],
  batches: [],
};

function renderAppWithSearch(search: string): string {
  vi.stubGlobal("window", {
    location: { search, pathname: "/" },
    history: { replaceState: vi.fn() },
  });
  mocks.useStudioData.mockReturnValue({
    data: emptyStudioData,
    refresh: mocks.refresh,
    busy: false,
    error: null,
  });
  return renderToString(React.createElement(MemoryRouter, null, React.createElement(App)));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.useStudioData.mockReset();
});

describe("Studio IA consolidation", () => {
  it("mounts the full Studio calendar layout from the calendar query state", () => {
    const html = renderAppWithSearch("?mode=studio&view=calendar");

    expect(readInitialAppQuery("?mode=studio&view=calendar")).toEqual({
      mode: "studio",
      studioView: "calendar",
      focusLyrics: false,
    });
    expect(html).toContain("Ready library");
    expect(html).toContain("Calendar view");
    expect(html).not.toContain("Create Batch");
  });

  it("redirects Autopilot lyrics query state into the routed wizard", () => {
    const html = renderAppWithSearch("?step=lyrics");

    expect(readInitialAppQuery("?step=lyrics")).toEqual({
      mode: "autopilot",
      studioView: "create",
      focusLyrics: true,
    });
    expect(autopilotRedirectPath("?step=lyrics")).toBe("/autopilot/lyrics?step=lyrics");
    expect(html).toBe("");
  });
});
