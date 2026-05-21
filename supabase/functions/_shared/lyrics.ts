import type { Transcript } from "./transcribe.ts";

export type RenderLyricWord = {
  id?: string;
  text?: string;
  word?: string;
  startMs?: number;
  endMs?: number;
  startTime?: number;
  endTime?: number;
  start?: number;
  end?: number;
  confidence?: number;
};

export type RenderLyricBlock = {
  id?: string;
  label?: string;
  text?: string;
  startMs?: number;
  endMs?: number;
  startTime?: number;
  endTime?: number;
  words?: RenderLyricWord[];
};

export type KanvasLyricWord = {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
};

export type KanvasLyricBlock = {
  id: string;
  label: string;
  startTime: number;
  endTime: number;
  words: KanvasLyricWord[];
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function msFrom(value: unknown): number | null {
  const numeric = numberOrNull(value);
  return numeric === null ? null : numeric;
}

function secFrom(value: unknown): number | null {
  const numeric = numberOrNull(value);
  return numeric === null ? null : Math.round(numeric * 1000);
}

function wordText(word: RenderLyricWord): string {
  return String(word.text ?? word.word ?? "").trim();
}

function wordStartMs(word: RenderLyricWord): number | null {
  return msFrom(word.startMs) ?? secFrom(word.startTime) ?? secFrom(word.start);
}

function wordEndMs(word: RenderLyricWord): number | null {
  return msFrom(word.endMs) ?? secFrom(word.endTime) ?? secFrom(word.end);
}

function blockStartMs(block: RenderLyricBlock, words: RenderLyricWord[]): number {
  return (
    msFrom(block.startMs) ??
    secFrom(block.startTime) ??
    wordStartMs(words[0] ?? {}) ??
    0
  );
}

function blockEndMs(block: RenderLyricBlock, words: RenderLyricWord[], startMs: number): number {
  const lastWord = words[words.length - 1] ?? {};
  const endMs =
    msFrom(block.endMs) ??
    secFrom(block.endTime) ??
    wordEndMs(lastWord) ??
    startMs + 1500;
  return endMs > startMs ? endMs : startMs + 1500;
}

function fmtTs(ms: number): string {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const cs = Math.floor(ms % 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(cs, 3)}`;
}

export function blocksToSrt(
  blocks: RenderLyricBlock[],
  selectionStartMs: number,
  totalSeconds: number,
): string {
  const totalMs = totalSeconds * 1000;
  const cues: { start: number; end: number; text: string }[] = [];
  for (const block of blocks ?? []) {
    const words = Array.isArray(block.words) ? block.words : [];
    const text = (block.text ?? words.map(wordText).join(" ")).trim().replace(/\s+/g, " ");
    if (!text) continue;

    const startMs = blockStartMs(block, words);
    const endMs = blockEndMs(block, words, startMs);
    const s = startMs - selectionStartMs;
    const e = endMs - selectionStartMs;
    if (e <= 0 || s >= totalMs) continue;
    cues.push({ start: Math.max(0, s), end: Math.min(totalMs, e), text });
  }
  return cues
    .map((cue, index) => `${index + 1}\n${fmtTs(cue.start)} --> ${fmtTs(cue.end)}\n${cue.text}\n`)
    .join("\n");
}

function fmtAssTs(ms: number): string {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/**
 * Build an ASS subtitle file with custom Fontname / weight / colours.
 * libass on fal.ai falls back to a system font when the named font isn't
 * installed, but PrimaryColour + OutlineColour always render — guaranteeing
 * visible per-video variation.
 */
export function blocksToAss(
  blocks: RenderLyricBlock[],
  selectionStartMs: number,
  totalSeconds: number,
  style: { fontName: string; fontWeight: string; primaryColour: string; outlineColour: string },
): string {
  const totalMs = totalSeconds * 1000;
  const cues: { start: number; end: number; text: string }[] = [];
  for (const block of blocks ?? []) {
    const words = Array.isArray(block.words) ? block.words : [];
    const text = (block.text ?? words.map(wordText).join(" ")).trim().replace(/\s+/g, " ");
    if (!text) continue;
    const startMs = blockStartMs(block, words);
    const endMs = blockEndMs(block, words, startMs);
    const s = startMs - selectionStartMs;
    const e = endMs - selectionStartMs;
    if (e <= 0 || s >= totalMs) continue;
    cues.push({ start: Math.max(0, s), end: Math.min(totalMs, e), text });
  }

  const bold = Number(style.fontWeight) >= 600 ? "-1" : "0";
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 720",
    "PlayResY: 1280",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Lyric,${style.fontName},72,${style.primaryColour},${style.primaryColour},${style.outlineColour},&H80000000,${bold},0,0,0,100,100,0,0,1,4,2,2,40,40,180,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events = cues
    .map(
      (cue) =>
        `Dialogue: 0,${fmtAssTs(cue.start)},${fmtAssTs(cue.end)},Lyric,,0,0,0,,${cue.text.replace(/\n/g, "\\N")}`,
    )
    .join("\n");

  return `${header}\n${events}\n`;
}

export function transcriptToKanvasLyricBlocks(transcript: Transcript): KanvasLyricBlock[] {
  const words = transcript.words.map((word, index) => ({
    id: `word-${index + 1}`,
    text: word.text,
    startTime: roundSeconds(word.start),
    endTime: roundSeconds(word.end),
  }));
  if (words.length === 0) return [];

  const blocks: KanvasLyricBlock[] = [];
  let current: KanvasLyricWord[] = [];

  for (const word of words) {
    const previous = current.at(-1);
    const gap = previous ? word.startTime - previous.endTime : 0;
    if (current.length > 0 && (current.length >= 8 || gap > 0.9)) {
      blocks.push(createBlock(blocks.length, current));
      current = [];
    }
    current.push(word);
  }

  if (current.length > 0) blocks.push(createBlock(blocks.length, current));
  return blocks;
}

function createBlock(index: number, words: KanvasLyricWord[]): KanvasLyricBlock {
  return {
    id: `block-${index + 1}`,
    label: `Line ${index + 1}`,
    startTime: words[0]?.startTime ?? 0,
    endTime: words.at(-1)?.endTime ?? 0,
    words,
  };
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
