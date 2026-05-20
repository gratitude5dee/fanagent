// Centralized app route paths. Keeps route strings consistent across pages.
export const appRoutes = {
  home: "/",
  lyricsHome: "/lyrics",
  lyricsNew: "/lyrics/new",
  lyricsTemplate: (id: string) => `/lyrics/${id}`,
  lyricsRemix: (id: string) => `/lyrics/${id}/remix`,
  lyricsJobs: (id: string) => `/lyrics/${id}/jobs`,
};
