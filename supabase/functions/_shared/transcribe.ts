// ElevenLabs Scribe v2 batch transcription helper.
// Returns { language, words[] } persisted to media_assets.transcript.

import { requireEnv } from "./env.ts";

export type TranscriptWord = {
  text: string;
  start: number;
  end: number;
};

export type Transcript = {
  language: string;
  text: string;
  words: TranscriptWord[];
};

export async function transcribeAudioBytes(
  bytes: Uint8Array,
  fileName = "audio.mp3",
): Promise<Transcript> {
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const form = new FormData();
  form.append("file", new Blob([bytes]), fileName);
  form.append("model_id", "scribe_v2");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Scribe v2 failed [${res.status}]: ${errText}`);
  }
  const data = await res.json() as {
    text?: string;
    language_code?: string;
    words?: Array<{ text: string; start: number; end: number; type?: string }>;
  };
  return {
    language: data.language_code ?? "eng",
    text: data.text ?? "",
    words: (data.words ?? [])
      .filter((w) => !w.type || w.type === "word")
      .map((w) => ({ text: w.text, start: w.start, end: w.end })),
  };
}

export async function transcribeAudioUrl(url: string): Promise<Transcript> {
  const dl = await fetch(url);
  if (!dl.ok) throw new Error(`Audio download failed: ${dl.status}`);
  const bytes = new Uint8Array(await dl.arrayBuffer());
  const fileName = url.split("/").pop() ?? "audio.mp3";
  return transcribeAudioBytes(bytes, fileName);
}
