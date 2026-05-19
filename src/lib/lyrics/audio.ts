// Client-side audio helpers: peaks decoding, deterministic fallback peaks,
// validation, and WAV slicing via OfflineAudioContext.

import { ALLOWED_AUDIO_MIME, MAX_AUDIO_BYTES } from "./types";

export function validateAudioFile(file: File): string | null {
  if (file.size > MAX_AUDIO_BYTES) return "File is larger than 50MB.";
  const lower = (file.type || "").toLowerCase();
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const okByMime = ALLOWED_AUDIO_MIME.some((m) => lower.startsWith(m));
  const okByExt = ["mp3", "wav", "m4a", "mp4", "aac", "flac", "ogg", "oga"].includes(ext);
  if (!okByMime && !okByExt) return "Unsupported audio format.";
  return null;
}

// Deterministic fallback waveform when the file can't be decoded.
export function fallbackPeaks(seed: string, count = 240): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    h = (h * 1664525 + 1013904223) | 0;
    const v = Math.abs(Math.sin(i * 0.31 + h * 0.0001));
    out.push(0.15 + 0.85 * v);
  }
  return out;
}

export async function decodePeaks(
  file: File,
  buckets = 240,
): Promise<{ peaks: number[]; durationSec: number }> {
  const Ctx: typeof AudioContext =
    (
      window as unknown as {
        AudioContext: typeof AudioContext;
        webkitAudioContext: typeof AudioContext;
      }
    ).AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buf = await file.arrayBuffer();
    const audio = await ctx.decodeAudioData(buf.slice(0));
    const ch = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / buckets));
    const peaks: number[] = [];
    for (let i = 0; i < buckets; i += 1) {
      let max = 0;
      const start = i * step;
      const end = Math.min(ch.length, start + step);
      for (let j = start; j < end; j += 1) {
        const v = Math.abs(ch[j]);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    // Normalize 0..1
    const m = Math.max(...peaks, 0.0001);
    const normalized = peaks.map((p) => Math.min(1, p / m));
    return { peaks: normalized, durationSec: audio.duration };
  } finally {
    ctx.close().catch(() => {});
  }
}

export async function sliceToWav(file: File, startSec: number, endSec: number): Promise<Blob> {
  const Ctx: typeof AudioContext =
    (
      window as unknown as {
        AudioContext: typeof AudioContext;
        webkitAudioContext: typeof AudioContext;
      }
    ).AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const buf = await file.arrayBuffer();
  const decoded = await ctx.decodeAudioData(buf.slice(0));
  await ctx.close().catch(() => {});

  const sr = decoded.sampleRate;
  const channels = Math.min(2, decoded.numberOfChannels);
  const start = Math.max(0, Math.floor(startSec * sr));
  const end = Math.min(decoded.length, Math.floor(endSec * sr));
  const length = Math.max(1, end - start);

  const off = new OfflineAudioContext(channels, length, sr);
  const src = off.createBufferSource();
  const sliced = off.createBuffer(channels, length, sr);
  for (let c = 0; c < channels; c += 1) {
    sliced.copyToChannel(decoded.getChannelData(c).subarray(start, end), c, 0);
  }
  src.buffer = sliced;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  return encodeWav(rendered);
}

function encodeWav(audio: AudioBuffer): Blob {
  const ch = audio.numberOfChannels;
  const sr = audio.sampleRate;
  const samples = audio.length;
  const bytesPerSample = 2;
  const dataSize = samples * ch * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeStr(off: number, s: string) {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  }

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * ch * bytesPerSample, true);
  view.setUint16(32, ch * bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const chans: Float32Array[] = [];
  for (let c = 0; c < ch; c += 1) chans.push(audio.getChannelData(c));
  for (let i = 0; i < samples; i += 1) {
    for (let c = 0; c < ch; c += 1) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}
