import { normalizeClipSelection, type ClipSelection } from "./generation.ts";
import type { SourceCandidate, SourceType } from "./sources/types.ts";
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
  indexOffset?: number;
};

export type SegmentLike = {
  source?: string | null;
  sourceType?: string | null;
  source_type?: string | null;
  provider?: string | null;
  externalId?: string | null;
  external_id?: string | null;
  url?: string | null;
  prompt?: string | null;
  query?: string | null;
  durationSec?: number | null;
  duration_seconds?: number | null;
  toleranceSec?: number | null;
  tolerance_seconds_used?: number | null;
  reused?: boolean | null;
  candidateId?: string | null;
  candidate_id?: string | null;
  license?: string | null;
  rightsHolder?: string | null;
  rights_holder?: string | null;
  attribution?: string | null;
  storagePath?: string | null;
  storage_path?: string | null;
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
  libraryMetadata?: unknown;
};

export type LibrarySegmentReplacementInput = {
  segments: unknown[];
  segmentIndex: number;
  candidate: SourceCandidate;
  cachedUrl: string;
  storagePath?: string | null;
  libraryDurationSec: number;
  toleranceSecondsUsed: number | null;
};

export type LibrarySegmentReplacement = {
  segments: SegmentLike[];
  provenance: Array<Record<string, unknown>>;
  replacedSegment: SegmentLike;
};

export type LibraryUnfitUpdateInput = {
  metadata?: unknown;
  reason?: unknown;
  now?: Date;
};

export type BatchLibraryStatus = "building" | "ready" | "exhausted" | "failed";

export type LibraryFailureUpdateInput = {
  metadata?: unknown;
  error?: unknown;
  now?: Date;
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

function clearFailureMetadata(value: unknown): Record<string, unknown> {
  const metadata = isRecord(value) ? { ...value } : {};
  delete metadata.failed;
  delete metadata.failure_error;
  delete metadata.failed_at;
  return metadata;
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
  const offset = Math.max(0, Math.floor(input.indexOffset ?? 0));
  return Array.from({ length: quantity }, (_, i) => ({
    account_id: input.accountId,
    audio_clip_id: input.audioClipId,
    batch_id: input.batchId,
    library_index: offset + i,
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
    reused_flags: buildReusedFlags(segments),
    default_caption: String(promptPlan.caption ?? "sound on"),
    default_hashtags: Array.isArray(promptPlan.hashtags) ? promptPlan.hashtags.map(String) : [],
    metadata: clearFailureMetadata(input.libraryMetadata),
  };
}

export function buildLibrarySegmentReplacement(
  input: LibrarySegmentReplacementInput,
): LibrarySegmentReplacement {
  if (!Number.isInteger(input.segmentIndex) || input.segmentIndex < 0) {
    throw new Error("segmentIndex must be a non-negative integer.");
  }

  const segments = input.segments.filter(isSegmentLike);
  if (input.segmentIndex >= segments.length) {
    throw new Error("segmentIndex is outside the current segment list.");
  }

  const current = segments[input.segmentIndex];
  if (!canReplaceSegmentSource(current, input.candidate.source_type)) {
    throw new Error("Candidate source_type does not match this segment.");
  }

  const replacedSegment: SegmentLike = {
    ...current,
    source: renderSegmentSource(input.candidate.source_type),
    sourceType: input.candidate.source_type,
    url: input.cachedUrl,
    provider: input.candidate.provider,
    externalId: input.candidate.external_id ?? null,
    candidateId: input.candidate.id ?? null,
    durationSec: Number(input.candidate.duration_seconds),
    toleranceSec: input.toleranceSecondsUsed,
    reused: false,
    license: input.candidate.license,
    rightsHolder: input.candidate.rights_holder ?? null,
    attribution: input.candidate.attribution ?? null,
    storagePath: input.storagePath ?? input.candidate.storage_path ?? null,
  };

  const nextSegments = [...segments];
  nextSegments[input.segmentIndex] = replacedSegment;

  return {
    segments: nextSegments,
    provenance: buildProvenance(nextSegments),
    replacedSegment,
  };
}

export function buildLibraryUnfitUpdate(
  input: LibraryUnfitUpdateInput = {},
): Record<string, unknown> {
  const now = input.now ?? new Date();
  const reason =
    typeof input.reason === "string" && input.reason.trim()
      ? input.reason.trim().slice(0, 240)
      : "Marked unfit by user";
  return {
    status: "blocked",
    metadata: {
      ...(isRecord(input.metadata) ? input.metadata : {}),
      unfit: true,
      unfit_reason: reason,
      marked_unfit_at: now.toISOString(),
    },
    updated_at: now.toISOString(),
  };
}

export function buildLibraryFailureUpdate(
  input: LibraryFailureUpdateInput = {},
): Record<string, unknown> {
  const now = input.now ?? new Date();
  const error =
    typeof input.error === "string" && input.error.trim()
      ? input.error.trim().slice(0, 500)
      : input.error instanceof Error
        ? input.error.message.slice(0, 500)
        : "Generation failed before this library item could be finalized.";
  return {
    status: "failed",
    metadata: {
      ...(isRecord(input.metadata) ? input.metadata : {}),
      failed: true,
      failure_error: error,
      failed_at: now.toISOString(),
    },
    updated_at: now.toISOString(),
  };
}

export function deriveBatchLibraryStatus(
  statuses: unknown[],
  requestedQuantity?: unknown,
): BatchLibraryStatus {
  const normalized = statuses.map(String).filter(Boolean);
  if (normalized.length === 0) return "building";
  const requested = Math.max(0, Math.floor(Number(requestedQuantity ?? normalized.length)));
  if (requested > 0 && normalized.length < requested) return "building";

  const readyStatuses = new Set(["ready", "scheduled", "posted"]);
  const failedStatuses = new Set(["failed", "blocked"]);
  const readyCount = normalized.filter((status) => readyStatuses.has(status)).length;
  const failedCount = normalized.filter((status) => failedStatuses.has(status)).length;

  if (readyCount === normalized.length) return "ready";
  if (failedCount === normalized.length) return "failed";
  if (readyCount + failedCount === normalized.length) return "exhausted";
  return "building";
}

export function segmentTargetDurationSeconds(input: {
  segment: unknown;
  segmentCount: number;
  libraryDurationSec: number;
}): number {
  if (isSegmentLike(input.segment)) {
    const explicit = Number(input.segment.durationSec ?? input.segment.duration_seconds ?? 0);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
  }
  return Math.max(1, Math.ceil(input.libraryDurationSec / Math.max(1, input.segmentCount)));
}

function buildProvenance(segments: unknown[]): Array<Record<string, unknown>> {
  return segments.filter(isSegmentLike).map((segment) => {
    const sourceType = segment.sourceType ?? segment.source_type ?? segment.source ?? "stock";
    return {
      source_type: sourceType,
      provider: segment.provider ?? sourceType,
      external_id: segment.externalId ?? segment.external_id ?? null,
      origin_url: segment.url ?? null,
      candidate_id: segment.candidateId ?? segment.candidate_id ?? null,
      license: segment.license ?? null,
      rights_holder: segment.rightsHolder ?? segment.rights_holder ?? null,
      attribution: segment.attribution ?? null,
      storage_path: segment.storagePath ?? segment.storage_path ?? null,
      reused: segment.reused ?? false,
    };
  });
}

function buildReusedFlags(segments: unknown[]): Record<string, boolean> {
  return Object.fromEntries(
    segments
      .map((segment, index) => [String(index), isSegmentLike(segment) && segment.reused === true])
      .filter((entry): entry is [string, boolean] => entry[1] === true),
  );
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function renderSegmentSource(sourceType: SourceType): "stock" | "seedance" {
  return sourceType === "seedance" || sourceType === "gmi_seedance" ? "seedance" : "stock";
}

function sourceClass(value: unknown): "stock" | "seedance" {
  return value === "seedance" || value === "gmi_seedance" ? "seedance" : "stock";
}

function canReplaceSegmentSource(segment: SegmentLike, candidateSourceType: SourceType): boolean {
  const explicitSourceType = segment.sourceType ?? segment.source_type;
  if (explicitSourceType) return explicitSourceType === candidateSourceType;
  return sourceClass(segment.source) === sourceClass(candidateSourceType);
}
