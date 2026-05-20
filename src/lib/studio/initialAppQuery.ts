export type InitialAppQuery = {
  mode: "autopilot" | "studio";
  studioView: "create" | "calendar";
  focusLyrics: boolean;
};

export function readInitialAppQuery(search?: string): InitialAppQuery {
  const source =
    search ?? (typeof window === "undefined" || !window.location ? "" : window.location.search);
  const params = new URLSearchParams(source);
  if (params.get("step") === "lyrics") {
    return { mode: "autopilot", studioView: "create", focusLyrics: true };
  }
  const modeParam = params.get("mode");
  const viewParam = params.get("view");
  return {
    mode: modeParam === "studio" ? "studio" : "autopilot",
    studioView: modeParam === "studio" && viewParam === "calendar" ? "calendar" : "create",
    focusLyrics: false,
  };
}
