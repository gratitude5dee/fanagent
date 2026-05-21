// Centralized app route paths. Keeps route strings consistent across pages.
export const appRoutes = {
  home: "/",
  autopilotConnect: "/autopilot/connect",
  autopilotUpload: "/autopilot/upload",
  autopilotLyrics: "/autopilot/lyrics",
  autopilotCampaign: "/autopilot/campaign",
  autopilotReview: "/autopilot/review",
  campaigns: "/campaigns",
  campaignDetail: (id: string) => `/campaigns/${id}`,
  lyricsHome: "/lyrics",
  lyricsNew: "/lyrics/new",
  lyricsTemplate: (id: string) => `/lyrics/${id}`,
  // "Remix" lands inside Autopilot → Campaign with the template preselected so
  // the user can immediately click "Generate library" against their saved
  // audio clip — no re-upload required.
  lyricsRemix: (id: string) => `/autopilot/campaign?lyricTemplateId=${encodeURIComponent(id)}`,
  lyricsJobs: (id: string) => `/lyrics/${id}/jobs`,
};

export function autopilotRedirectPath(search: string): string {
  const params = new URLSearchParams(search);
  const next = new URLSearchParams();
  const lyricTemplateId = params.get("lyricTemplateId");
  if (lyricTemplateId) next.set("lyricTemplateId", lyricTemplateId);

  const step = params.get("step");
  const view = params.get("view");
  let path = appRoutes.autopilotConnect;
  if (step === "lyrics" || view === "lyrics") {
    path = appRoutes.autopilotLyrics;
    next.set("step", "lyrics");
  } else if (view === "upload") path = appRoutes.autopilotUpload;
  else if (view === "campaign") path = appRoutes.autopilotCampaign;
  else if (view === "review") path = appRoutes.autopilotReview;

  const query = next.toString();
  return query ? `${path}?${query}` : path;
}
