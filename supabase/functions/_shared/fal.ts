// Minimal fal.ai client for Seedance text-to-video and ffmpeg-api compose.
// Uses the synchronous run endpoint for simplicity.

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

// Generate a single 5s vertical clip via Seedance v1 lite text-to-video.
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

// Stitch multiple video URLs end-to-end and overlay a single audio track via
// fal-ai/ffmpeg-api/compose. Each segment is trimmed to `segmentSeconds`.
export async function stitchClipsWithAudio(input: {
  clipUrls: string[];
  audioUrl: string;
  segmentSeconds: number;
  totalSeconds: number;
}): Promise<string> {
  const tracks = [
    {
      id: "video",
      type: "video",
      keyframes: input.clipUrls.map((url, i) => ({
        url,
        timestamp: i * input.segmentSeconds,
        duration: input.segmentSeconds,
      })),
    },
    {
      id: "audio",
      type: "audio",
      keyframes: [{ url: input.audioUrl, timestamp: 0, duration: input.totalSeconds }],
    },
  ];
  const out = await falRun<{ video_url?: string; video?: { url?: string } }>(
    "fal-ai/ffmpeg-api/compose",
    { tracks },
  );
  const url = out?.video_url ?? out?.video?.url;
  if (!url) throw new Error(`ffmpeg compose returned no URL: ${JSON.stringify(out).slice(0, 300)}`);
  return url;
}

// Compose a single video with audio + burned-in subtitles via fal ffmpeg-api.
// `subtitlesUrl` must be a publicly fetchable .srt URL.
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
  const out = await falRun<{ video_url?: string; video?: { url?: string } }>(
    "fal-ai/ffmpeg-api/compose",
    { tracks },
  );
  const url = out?.video_url ?? out?.video?.url;
  if (!url) throw new Error(`ffmpeg compose (subs) returned no URL: ${JSON.stringify(out).slice(0, 300)}`);
  return url;
}

