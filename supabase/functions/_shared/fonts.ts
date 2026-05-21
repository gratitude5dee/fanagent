// Deterministic per-item font + color picker for burned-in lyric subtitles.
// Used by render-karaoke to vary the visual treatment per video. Because
// fal.ai's ffmpeg-api libass renderer doesn't ship arbitrary font files, we
// thread the font *name* through to ASS (libass falls back to a default font
// when the named font isn't installed) and rely on a per-item PrimaryColour
// to guarantee visible variation regardless of what fal substitutes.

export type LyricFont = {
  name: string;
  weight: string;
  // ASS PrimaryColour in &HAABBGGRR format (alpha first, then BGR — yes,
  // libass really does BGR not RGB).
  primaryColour: string;
  // Outline colour in the same &HAABBGGRR format.
  outlineColour: string;
};

export const LYRIC_FONTS: ReadonlyArray<LyricFont> = [
  // White text variants with different outline colours.
  { name: "Impact",            weight: "900", primaryColour: "&H00FFFFFF", outlineColour: "&H00000000" },
  { name: "Bebas Neue",        weight: "400", primaryColour: "&H00FFFFFF", outlineColour: "&H00DC2626" }, // red outline
  { name: "Anton",             weight: "400", primaryColour: "&H0014F0FF", outlineColour: "&H00000000" }, // amber text
  { name: "Oswald",            weight: "700", primaryColour: "&H00FFFFFF", outlineColour: "&H00ED7C3A" }, // violet-ish outline
  { name: "Barlow Condensed",  weight: "800", primaryColour: "&H0000C5FB", outlineColour: "&H00000000" }, // orange text
  { name: "Russo One",         weight: "400", primaryColour: "&H00FFFFFF", outlineColour: "&H0022C55E" }, // green outline
  { name: "Black Han Sans",    weight: "400", primaryColour: "&H00F0F8FF", outlineColour: "&H00C026D3" }, // magenta outline
  { name: "Boogaloo",          weight: "400", primaryColour: "&H0050E3FF", outlineColour: "&H00000000" }, // yellow text
];

/** Deterministic font selection: hash the item ID to pick an index. */
export function pickFont(itemId: string): LyricFont {
  let hash = 0;
  for (let i = 0; i < itemId.length; i += 1) {
    hash = (hash * 31 + itemId.charCodeAt(i)) >>> 0;
  }
  return LYRIC_FONTS[hash % LYRIC_FONTS.length];
}
