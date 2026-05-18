import { normalizeClipSelection, type ClipSelection } from "./generation.ts";
import type { Transcript } from "./transcribe.ts";

const supportedAudio = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/x-flac",
]);

const allowedDurations = new Set([15, 30, 45, 60, 75, 90]);
const maxAudioBytes = 50 * 1024 * 1024;

export type AudioClipRequest = {
  accountId?: string;
  audioBase64?: string;
  audioMimeType?: string;
  audioFileName?: string;
  clipSelection?: unknown;
};

export type NormalizedAudioClipRequest = {
  accountId: string;
  audioBytes: Uint8Array;
  audioMimeType: string;
  audioFileName: string;
  clipSelection: ClipSelection;
};

export type LyricBlockWord = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
};

export type LyricBlock = {
  id: string;
  label: string;
  text: string;
  startMs: number;
  endMs: number;
  words: LyricBlockWord[];
};

export type LibrarySlotInput = {
  accountId: string;
  audioClipId: string;
  batchId: string;
  quantity: number;
  durationSec: number;
};

export type SegmentLike = {
  source?: string | null;
  provider?: string | null;
  externalId?: string | null;
  external_id?: string | null;
  url?: string | null;
  prompt?: string | null;
};

export type LibraryFinalizeInput = {
  item: {
    id: string;
    final_asset_id: string | null;
    duration_seconds: number | null;
    segments?: unknown;
    perceptual_hash?: string | null;
    input_payload?: unknown;
  };
  asset: {
    id: string;
    public_url: string;
    metadata?: unknown;
  };
};

function normalizeAudioBase64(value: string): string {
  return value.includes(",") ? (value.split(",").at(-1) ?? "") : value;
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function assertAllowedDuration(durationSec: number): void {
  if (!allowedDurations.has(durationSec)) {
    throw new Error("clipSelection.durationSec must be one of 15, 30, 45, 60, 75, or 90.");
  }
}

function roundMs(value: number): number {
  return Math.round(value * 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSegmentLike(value: unknown): value is SegmentLike {
  return isRecord(value);
}

export function normalizeAudioClipRequest(body: AudioClipRequest): NormalizedAudioClipRequest {
  if (!body.accountId) throw new Error("accountId is required.");
  if (!body.audioBase64) throw new Error("audioBase64 is required.");

  const audioMimeType = body.audioMimeType || "audio/mpeg";
  if (!supportedAudio.has(audioMimeType)) {
    throw new Error(`Unsupported audio MIME type: ${audioMimeType}`);
  }

  const audioFileName = body.audioFileName || "audio-upload";
  const clipSelection = normalizeClipSelection(body.clipSelection, undefined, audioFileName);
  if (!clipSelection) {
    throw new Error("clipSelection with startSec, endSec, and durationSec is required.");
  }
  assertAllowedDuration(Math.round(clipSelection.durationSec));

  const audioBytes = decodeBase64(normalizeAudioBase64(body.audioBase64));
  if (audioBytes.byteLength > maxAudioBytes) {
    throw new Error("Audio uploads are limited to 50MB.");
  }

  return {
    accountId: body.accountId,
    audioBytes,
    audioMimeType,
    audioFileName,
    clipSelection: {
      ...clipSelection,
      durationSec: Math.round(clipSelection.durationSec),
    },
  };
}

export function buildLyricBlocksFromTranscript(transcript: Transcript): LyricBlock[] {
  const words = transcript.words.map((word, index) => ({
    id: `word-${index + 1}`,
    text: word.text,
    startMs: roundMs(word.start),
    endMs: roundMs(word.end),
  }));
  if (words.length === 0) return [];

  const blocks: LyricBlock[] = [];
  let current: LyricBlockWord[] = [];

  for (const word of words) {
    const previous = current.at(-1);
    const gapMs = previous ? word.startMs - previous.endMs : 0;
    if (current.length > 0 && (current.length >= 8 || gapMs > 900)) {
      blocks.push(createBlock(blocks.length, current));
      current = [];
    }
    current.push(word);
  }

  if (current.length > 0) blocks.push(createBlock(blocks.length, current));
  return blocks;
}

function createBlock(index: number, words: LyricBlockWord[]): LyricBlock {
  return {
    id: `block-${index + 1}`,
    label: `Line ${index + 1}`,
    text: words.map((word) => word.text).join(" "),
    startMs: words[0]?.startMs ?? 0,
    endMs: words.at(-1)?.endMs ?? 0,
    words,
  };
}

export function buildLibrarySlotRows(input: LibrarySlotInput): Array<Record<string, unknown>> {
  const quantity = Math.max(1, Math.min(Math.floor(input.quantity), 250));
  return Array.from({ length: quantity }, (_, libraryIndex) => ({
    account_id: input.accountId,
    audio_clip_id: input.audioClipId,
    batch_id: input.batchId,
    library_index: libraryIndex,
    status: "not_ready",
    duration_sec: input.durationSec,
  }));
}

export function buildLibraryFinalizeUpdate(input: LibraryFinalizeInput): Record<string, unknown> {
  const assetMetadata = isRecord(input.asset.metadata) ? input.asset.metadata : {};
  const itemPayload = isRecord(input.item.input_payload) ? input.item.input_payload : {};
  const promptPlan = isRecord(itemPayload.prompt_plan) ? itemPayload.prompt_plan : {};
  const segments = Array.isArray(input.item.segments) ? input.item.segments : [];

  return {
    status: "ready",
    final_asset_id: input.item.final_asset_id ?? input.asset.id,
    thumbnail_url: String(assetMetadata.thumbnail_url ?? input.asset.public_url),
    duration_sec: Math.round(input.item.duration_seconds ?? 15),
    segments,
    provenance: buildProvenance(segments),
    perceptual_hash: input.item.perceptual_hash ?? stringOrNull(assetMetadata.perceptual_hash),
    default_caption: String(promptPlan.caption ?? "sound on"),
    default_hashtags: Array.isArray(promptPlan.hashtags) ? promptPlan.hashtags.map(String) : [],
  };
}

function buildProvenance(segments: unknown[]): Array<Record<string, unknown>> {
  return segments.filter(isSegmentLike).map((segment) => {
    const sourceType = segment.source ?? "stock";
    return {
      source_type: sourceType,
      provider: segment.provider ?? sourceType,
      external_id: segment.externalId ?? segment.external_id ?? null,
      origin_url: segment.url ?? null,
    };
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
