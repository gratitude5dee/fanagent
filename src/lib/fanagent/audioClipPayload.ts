export type TrimmedAudioInput = {
  blob: Blob;
  durationSec: number;
  name: string;
  startSec: number;
  endSec: number;
  originalFileName: string;
};

export type RegisteredAudioClipSummary = {
  id: string;
  duration_sec: number;
  file_name: string | null;
  transcription_status: string;
  selection_start_sec: number;
  selection_end_sec: number;
};

export type AudioClipRegisterResponse = {
  audio_clip: RegisteredAudioClipSummary;
  media: {
    asset_id: string;
    public_url: string | null;
    mime_type: string | null;
    duration_seconds: number | null;
  };
};

export type AudioClipTranscribeResponse = {
  audio_clip: RegisteredAudioClipSummary;
  transcript: {
    text?: string;
    language?: string;
    words?: unknown[];
    blocks?: unknown[];
  };
};

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function wavFileName(name: string): string {
  const clean = name.trim() || "audio-upload";
  return `${clean.replace(/\.[^.]+$/, "")}.wav`;
}

export async function buildAudioClipRegisterBody(input: {
  accountId: string;
  trimmedAudio: TrimmedAudioInput;
}): Promise<Record<string, unknown>> {
  return {
    accountId: input.accountId,
    audioBase64: await blobToBase64(input.trimmedAudio.blob),
    audioMimeType: input.trimmedAudio.blob.type || "audio/wav",
    audioFileName: wavFileName(input.trimmedAudio.name),
    clipSelection: {
      startSec: input.trimmedAudio.startSec,
      endSec: input.trimmedAudio.endSec,
      durationSec: input.trimmedAudio.durationSec,
      originalFileName: input.trimmedAudio.originalFileName,
    },
  };
}
