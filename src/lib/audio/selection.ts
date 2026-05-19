export const MAX_AUDIO_UPLOAD_BYTES = 50 * 1024 * 1024;

export const AUDIO_ACCEPT = [
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/x-flac",
].join(",");

const supportedAudioMimeTypes = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/x-flac",
]);

const supportedAudioExtensions = new Set(["mp3", "wav", "m4a", "aac", "flac"]);

export type AudioUploadCandidate = {
  name?: string;
  size?: number;
  type?: string;
};

export type AudioRegion = {
  startSec: number;
  endSec: number;
};

function extensionFromName(name?: string): string {
  return name?.split(".").pop()?.toLowerCase() ?? "";
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function isSupportedAudioUpload(file: AudioUploadCandidate): boolean {
  const mimeType = file.type?.toLowerCase() ?? "";
  if (mimeType && supportedAudioMimeTypes.has(mimeType)) return true;
  return supportedAudioExtensions.has(extensionFromName(file.name));
}

export function validateAudioUpload(file: AudioUploadCandidate): void {
  if (Number(file.size ?? 0) > MAX_AUDIO_UPLOAD_BYTES) {
    throw new Error("Audio uploads are limited to 50 MB.");
  }
  if (!isSupportedAudioUpload(file)) {
    throw new Error("Use an MP3, WAV, M4A, AAC, or FLAC audio file.");
  }
}

export function clampFixedDurationRegion(input: {
  audioDurationSec: number;
  startSec: number;
  targetDurationSec: number;
}): AudioRegion {
  const audioDurationSec = Math.max(0, Number(input.audioDurationSec));
  const targetDurationSec = Math.max(0, Number(input.targetDurationSec));
  if (!Number.isFinite(audioDurationSec) || audioDurationSec <= 0) {
    return { startSec: 0, endSec: 0 };
  }
  const span = Math.min(audioDurationSec, targetDurationSec);
  const maxStart = Math.max(0, audioDurationSec - span);
  const startSec = Math.min(Math.max(0, Number(input.startSec)), maxStart);
  return {
    startSec: roundSeconds(startSec),
    endSec: roundSeconds(startSec + span),
  };
}

export function clipSelectionMatchesDuration(
  region: AudioRegion,
  targetDurationSec: number,
  toleranceSec = 0.05,
): boolean {
  const selectedDurationSec = region.endSec - region.startSec;
  return Math.abs(selectedDurationSec - targetDurationSec) <= toleranceSec;
}
