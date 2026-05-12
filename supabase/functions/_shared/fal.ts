// fal.ai client wrappers for ffmpeg-api/* endpoints + Seedance text-to-video.
// Uses the synchronous REST endpoint (https://fal.run/<model>) which works
// cleanly in Deno edge runtime (no @fal-ai/client npm dependency needed).

import { optionalEnv } from "./env.ts";

function falKey(): string {
  const key = optionalEnv("FAL_KEY");
  if (!key) throw new Error("FAL_KEY is not configured");
  return key;
}

export async function falRun<T = unknown>(model: string, input: unknown): Promise<T> {
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai ${model} failed [${res.status}]: ${text.slice(0, 500)}`);
  }
  return await res.json() as T;
}

function pickUrl(out: any): string | undefined {
  return out?.video_url ??
    out?.video?.url ??
    out?.audio_url ??
    out?.audio?.url ??
    out?.image?.url ??
    out?.image_url ??
    out?.url ??
    out?.output?.url;
}

// ---------- ffmpeg-api primitives ----------

export async function mergeVideos(videoUrls: string[]): Promise<{ url: string; raw: any }> {
  const out = await falRun<any>("fal-ai/ffmpeg-api/merge-videos", { video_urls: videoUrls });
  const url = pickUrl(out);
  if (!url) throw new Error(`merge-videos returned no URL: ${JSON.stringify(out).slice(0, 300)}`);
  return { url, raw: out };
}

export async function compose(tracks: unknown[]): Promise<{ url: string; raw: any }> {
  const out = await falRun<any>("fal-ai/ffmpeg-api/compose", { tracks });
  const url = pickUrl(out);
  if (!url) throw new Error(`compose returned no URL: ${JSON.stringify(out).slice(0, 300)}`);
  return { url, raw: out };
}

export async function mergeAudioVideo(videoUrl: string, audioUrl: string): Promise<{ url: string; raw: any }> {
  const out = await falRun<any>("fal-ai/ffmpeg-api/merge-audio-video", {
    video_url: videoUrl,
    audio_url: audioUrl,
  });
  const url = pickUrl(out);
  if (!url) throw new Error(`merge-audio-video returned no URL: ${JSON.stringify(out).slice(0, 300)}`);
  return { url, raw: out };
}

export async function extractFrame(
  videoUrl: string,
  position: "first" | "middle" | "last" = "middle",
): Promise<{ url: string; raw: any }> {
  const out = await falRun<any>("fal-ai/ffmpeg-api/extract-frame", {
    video_url: videoUrl,
    position,
    output_format: "png",
  });
  const url = pickUrl(out);
  if (!url) throw new Error(`extract-frame returned no URL: ${JSON.stringify(out).slice(0, 300)}`);
  return { url, raw: out };
}

export async function getMediaMetadata(fileUrl: string): Promise<any> {
  return await falRun<any>("fal-ai/ffmpeg-api/metadata", { file_url: fileUrl });
}

export async function mergeAudios(audioUrls: string[]): Promise<{ url: string; raw: any }> {
  const out = await falRun<any>("fal-ai/ffmpeg-api/merge-audios", { audio_urls: audioUrls });
  const url = pickUrl(out);
  if (!url) throw new Error(`merge-audios returned no URL: ${JSON.stringify(out).slice(0, 300)}`);
  return { url, raw: out };
}

export async function loudnorm(
  audioUrl: string,
  opts: { targetI?: number; targetTp?: number; targetLra?: number; outputFormat?: string } = {},
): Promise<{ url: string; raw: any }> {
  const out = await falRun<any>("fal-ai/ffmpeg-api/loudnorm", {
    audio_url: audioUrl,
    target_i: opts.targetI ?? -16,
    target_tp: opts.targetTp ?? -1.5,
    target_lra: opts.targetLra ?? 11,
    output_format: opts.outputFormat ?? "wav",
  });
  const url = pickUrl(out);
  if (!url) throw new Error(`loudnorm returned no URL: ${JSON.stringify(out).slice(0, 300)}`);
  return { url, raw: out };
}

export async function waveform(audioUrl: string, opts: Record<string, unknown> = {}): Promise<any> {
  return await falRun<any>("fal-ai/ffmpeg-api/waveform", { audio_url: audioUrl, ...opts });
}

// ---------- Seedance text-to-video ----------

export async function generateSeedanceClip(prompt: string): Promise<string> {
  const model = optionalEnv("SEEDANCE_MODEL_ID") ?? "fal-ai/bytedance/seedance/v1/lite/text-to-video";
  const out = await falRun<{ video?: { url?: string }; url?: string }>(model, {
    prompt,
    aspect_ratio: "9:16",
    resolution: "720p",
    duration: "5",
  });
  const url = out?.video?.url ?? out?.url;
  if (!url) throw new Error(`Seedance returned no video URL: ${JSON.stringify(out).slice(0, 300)}`);
  return url;
}

// ---------- High-level helpers (back-compat) ----------

// Stitch multiple video URLs end-to-end and overlay a single audio track.
// Routing:
//   - all clips full-length (segmentSeconds matches clip duration assumption) →
//     mergeVideos + mergeAudioVideo (cheaper, no per-keyframe trim semantics)
//   - otherwise → compose timeline with explicit per-clip durations
export async function stitchClipsWithAudio(input: {
  clipUrls: string[];
  audioUrl: string;
  segmentSeconds: number;
  totalSeconds: number;
  forceCompose?: boolean;
}): Promise<string> {
  const { clipUrls, audioUrl, segmentSeconds, totalSeconds, forceCompose } = input;
  const expectedTotal = segmentSeconds * clipUrls.length;
  const evenSplit = Math.abs(expectedTotal - totalSeconds) <= 1;

  if (!forceCompose && evenSplit) {
    try {
      const merged = clipUrls.length === 1
        ? { url: clipUrls[0], raw: null }
        : await mergeVideos(clipUrls);
      const out = await mergeAudioVideo(merged.url, audioUrl);
      return out.url;
    } catch (err) {
      console.warn(`[fal] mergeVideos+mergeAudioVideo failed, falling back to compose: ${err}`);
    }
  }

  const tracks = [
    {
      id: "video",
      type: "video",
      keyframes: clipUrls.map((url, i) => ({
        url,
        timestamp: i * segmentSeconds,
        duration: segmentSeconds,
      })),
    },
    {
      id: "audio",
      type: "audio",
      keyframes: [{ url: audioUrl, timestamp: 0, duration: totalSeconds }],
    },
  ];
  const out = await compose(tracks);
  return out.url;
}

// Compose video + audio + burned-in subtitles. compose is the only ffmpeg-api
// endpoint that supports a subtitles track, so this stays on compose.
export async function composeWithSubtitles(input: {
  videoUrl: string;
  audioUrl: string;
  subtitlesUrl: string;
  totalSeconds: number;
}): Promise<string> {
  const tracks = [
    {
      id: "video",
      type: "video",
      keyframes: [{ url: input.videoUrl, timestamp: 0, duration: input.totalSeconds }],
    },
    {
      id: "audio",
      type: "audio",
      keyframes: [{ url: input.audioUrl, timestamp: 0, duration: input.totalSeconds }],
    },
    {
      id: "subs",
      type: "subtitles",
      keyframes: [{ url: input.subtitlesUrl, timestamp: 0, duration: input.totalSeconds }],
    },
  ];
  const out = await compose(tracks);
  return out.url;
}
