export type SourceMode = "stock" | "seedance" | "mixed" | "gmi_seedance" | "remote_render";

const themes = [
  "cinematic",
  "aesthetic",
  "street",
  "nature",
  "abstract",
] as const;
const moods = [
  "charged",
  "intimate",
  "glossy",
  "kinetic",
  "dreamlike",
  "late-night",
];

function pick<T>(values: readonly T[], index: number): T {
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
  durationSeconds?: 15 | 30 | 60;
}) {
  const subject = cleanPrompt(input.basePrompt);
  const theme = pick(themes, input.index);
  const mood = pick(moods, input.index);
  const duration = input.durationSeconds ?? 15;
  const shotSize = input.index % 3 === 0
    ? "wide vertical frame"
    : input.index % 3 === 1
    ? "medium close vertical frame"
    : "profile close-up vertical frame";
  const movement = input.index % 2 === 0
    ? "slow push-in with steady gimbal movement"
    : "sideways tracking move with gentle handheld energy";

  return {
    prompt: [
      `${subject}, one complete vertical social video shot`,
      `context: ${theme} environment timed to an uploaded music reference`,
      `framed as a ${shotSize}, normal lens feel, shallow background separation`,
      movement,
      "soft practical light, visible atmosphere, practical reflections, no logos or watermarks",
      "polished short-form music edit grade",
      `${duration} seconds, 9:16 aspect ratio, leave clean space for caption text`,
    ].join(", "),
    caption: `${input.index % 2 === 0 ? "wait for it" : "sound on"}. ${subject}`
      .slice(0, 140),
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

export function buildSchedule(
  startAt: Date,
  count: number,
  cadenceMinutes: number,
): Date[] {
  const safeCount = Math.max(1, Math.min(Math.floor(count), 50));
  const safeCadence = Math.max(
    5,
    Math.min(Math.floor(cadenceMinutes), 7 * 24 * 60),
  );
  return Array.from(
    { length: safeCount },
    (_, index) => new Date(startAt.getTime() + index * safeCadence * 60_000),
  );
}

export function findGmiVideoUrl(outcome: unknown): string | undefined {
  if (!outcome || typeof outcome !== "object") return undefined;
  if ("video_url" in outcome && typeof outcome.video_url === "string") {
    return outcome.video_url;
  }
  if (
    "url" in outcome && typeof outcome.url === "string" &&
    /\.(mp4|mov)(\?|$)/i.test(outcome.url)
  ) return outcome.url;
  for (const value of Object.values(outcome)) {
    if (typeof value === "string" && /\.(mp4|mov)(\?|$)/i.test(value)) {
      return value;
    }
    const nested = findGmiVideoUrl(value);
    if (nested) return nested;
  }
  return undefined;
}
