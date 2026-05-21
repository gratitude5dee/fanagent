// Centralized app route paths. Keeps route strings consistent across pages.
export const appRoutes = {
  home: "/",
  lyricsHome: "/lyrics",
  lyricsNew: "/lyrics/new",
  lyricsTemplate: (id: string) => `/lyrics/${id}`,
  // "Remix" lands inside Autopilot → Campaign with the template preselected so
  // the user can immediately click "Generate library" against their saved
  // audio clip — no re-upload required.
  lyricsRemix: (id: string) =>
    `/?mode=autopilot&view=campaign&lyricTemplateId=${encodeURIComponent(id)}`,
  lyricsJobs: (id: string) => `/lyrics/${id}/jobs`,
};
