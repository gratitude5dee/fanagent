export type VideoTheme = "cinematic" | "aesthetic" | "street" | "nature" | "abstract";
export type VideoDuration = 15 | 30 | 45 | 60 | 75 | 90;

export type PromptPlan = {
  prompt: string;
  caption: string;
  hookText: string;
  hashtags: string[];
  videoPrompt: {
    theme: VideoTheme;
    mood: string;
    duration_seconds: VideoDuration;
    aspect_ratio: "9:16";
  };
};

const themes: VideoTheme[] = ["cinematic", "aesthetic", "street", "nature", "abstract"];
const moods = ["charged", "intimate", "glossy", "kinetic", "dreamlike", "late-night"];

function pick<T>(values: T[], index: number): T {
  return values[index % values.length];
}

function cleanPrompt(value?: string): string {
  return (value || "music-driven fan edit with cinematic lifestyle visuals")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

export function createPromptPlan(input: {
  basePrompt?: string;
  index: number;
  total: number;
  durationSeconds?: VideoDuration;
}): PromptPlan {
  const subject = cleanPrompt(input.basePrompt);
  const theme = pick(themes, input.index);
  const mood = pick(moods, input.index);
  const duration = input.durationSeconds ?? 15;
  const shotSize =
    input.index % 3 === 0
      ? "wide vertical frame"
      : input.index % 3 === 1
        ? "medium close vertical frame"
        : "profile close-up vertical frame";
  const movement =
    input.index % 2 === 0
      ? "slow push-in with steady gimbal movement"
      : "sideways tracking move with gentle handheld energy";
  const lighting =
    input.index % 2 === 0
      ? "soft practical backlight and clean highlights"
      : "natural side light with reflective surfaces";
  const color =
    theme === "street"
      ? "cool city contrast with red accent hits"
      : theme === "nature"
        ? "fresh greens, silver water highlights, and warm skin-safe exposure"
        : "deep blacks, crisp whites, and saturated music-video accents";

  return {
    prompt: [
      `${subject}, one complete vertical social video shot`,
      `context: ${theme} environment timed to an uploaded music reference`,
      `framed as a ${shotSize}, normal lens feel, shallow background separation`,
      movement,
      `${lighting}, visible atmosphere, practical reflections, no logos or watermarks`,
      `${color}, polished short-form music edit grade`,
      `${duration} seconds, 9:16 aspect ratio, leave clean space for caption text`,
    ].join(", "),
    caption: `${input.index % 2 === 0 ? "wait for it" : "sound on"}. ${subject}`.slice(0, 140),
    hookText: input.index % 2 === 0 ? "wait for it" : "sound on",
    hashtags: ["#fyp", "#music", "#edit", "#fanpage", "#newmusic", "#viral"],
    videoPrompt: {
      theme,
      mood,
      duration_seconds: duration,
      aspect_ratio: "9:16",
    },
  };
}
