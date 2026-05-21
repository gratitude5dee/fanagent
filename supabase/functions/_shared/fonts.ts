export const LYRIC_FONTS = [
  { name: "Impact", style: "normal", weight: "900", outline: "#7c3aed" },
  { name: "Bebas Neue", style: "normal", weight: "400", outline: "#a855f7" },
  { name: "Anton", style: "normal", weight: "400", outline: "#22c55e" },
  { name: "Oswald", style: "normal", weight: "700", outline: "#f59e0b" },
  { name: "Barlow Condensed", style: "normal", weight: "800", outline: "#06b6d4" },
  { name: "Russo One", style: "normal", weight: "400", outline: "#ef4444" },
  { name: "Black Han Sans", style: "normal", weight: "400", outline: "#f97316" },
  { name: "Boogaloo", style: "normal", weight: "400", outline: "#ec4899" },
] as const;

export type LyricFont = typeof LYRIC_FONTS[number];

export function pickFont(itemId: string): LyricFont {
  let hash = 0;
  for (let i = 0; i < itemId.length; i++) {
    hash = (hash * 31 + itemId.charCodeAt(i)) >>> 0;
  }
  return LYRIC_FONTS[hash % LYRIC_FONTS.length];
}

