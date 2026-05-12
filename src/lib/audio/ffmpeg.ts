// Lazy-loaded ffmpeg.wasm singleton for client-side audio trimming.
// Only imported by browser code (AudioTrimmer). Never import from server code.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let instance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

async function load(): Promise<FFmpeg> {
  const ff = new FFmpeg();
  await ff.load({
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
  });
  return ff;
}

export async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  if (!loadingPromise) {
    loadingPromise = load().then((ff) => {
      instance = ff;
      return ff;
    });
  }
  return loadingPromise;
}

function extOf(file: File): string {
  const m = /\.([a-z0-9]+)$/i.exec(file.name);
  if (m) return m[1].toLowerCase();
  if (file.type.includes("wav")) return "wav";
  if (file.type.includes("mp4") || file.type.includes("m4a")) return "m4a";
  return "mp3";
}

export async function trimAudio(
  file: File,
  startSec: number,
  endSec: number,
): Promise<Blob> {
  const ff = await getFFmpeg();
  const inExt = extOf(file);
  const inName = `in.${inExt}`;
  const outName = `out.mp3`;
  await ff.writeFile(inName, await fetchFile(file));
  const dur = Math.max(0.1, endSec - startSec);
  // Re-encode to mp3 to guarantee a clean cut and a portable container.
  await ff.exec([
    "-ss", startSec.toFixed(3),
    "-t", dur.toFixed(3),
    "-i", inName,
    "-vn",
    "-acodec", "libmp3lame",
    "-q:a", "2",
    outName,
  ]);
  const data = await ff.readFile(outName);
  await ff.deleteFile(inName).catch(() => {});
  await ff.deleteFile(outName).catch(() => {});
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  return new Blob([bytes], { type: "audio/mpeg" });
}
