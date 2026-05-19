// Edge function wrappers. All numeric values cross the boundary in milliseconds.
import { supabase } from "@/integrations/supabase/client";
import type { LyricBlock, LyricTemplate, TemplateStatus } from "./types";

type FunctionEnvelope<T> = {
  success: boolean;
  code?: string;
  message?: string;
  data: T | null;
  error?: string | null;
};

function unwrapFunctionData<T>(value: unknown): T {
  if (typeof value !== "object" || value === null || !("success" in value)) return value as T;
  const envelope = value as FunctionEnvelope<T>;
  if (envelope.success) return envelope.data as T;
  throw new Error(envelope.error || envelope.message || envelope.code || "Function failed");
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<unknown>(fn, { body });
  if (error) {
    if (data) return unwrapFunctionData<T>(data);
    throw new Error(error.message);
  }
  return unwrapFunctionData<T>(data);
}

export const lyricsApi = {
  registerAudio(input: {
    storagePath: string;
    mimeType: string;
    fileName: string;
    byteSize: number;
    durationMs: number;
    kind?: "audio" | "audio_trimmed";
  }) {
    return call<{ id: string; signedUrl: string }>("kanvas-lyrics-audio-register", input);
  },
  create(payload: {
    title?: string;
    sourceAssetId?: string | null;
    trimmedAssetId?: string | null;
    selectionStartMs?: number;
    selectionDurationMs?: number;
    totalDurationMs?: number;
    waveformPeaks?: number[];
  }) {
    return call<{ template: LyricTemplate }>("kanvas-lyrics-template", {
      action: "create",
      ...payload,
    });
  },
  createFromAudioClip(payload: { audioClipId: string; title?: string; force?: boolean }) {
    return call<{ template: LyricTemplate }>("kanvas-lyrics-template", {
      action: "createFromAudioClip",
      ...payload,
    });
  },
  get(templateId: string) {
    return call<{ template: LyricTemplate }>("kanvas-lyrics-template", {
      action: "get",
      templateId,
    });
  },
  list() {
    return call<{ templates: LyricTemplate[] }>("kanvas-lyrics-template", { action: "list" });
  },
  patch(
    templateId: string,
    patch: Partial<{
      title: string;
      status: TemplateStatus;
      selection_start_ms: number;
      selection_duration_ms: number;
      total_duration_ms: number;
      waveform_peaks: number[];
      lyric_blocks: LyricBlock[];
      cut_markers: number[];
      error_message: string | null;
      trimmed_audio_asset_id: string | null;
    }>,
  ) {
    return call<{ template: LyricTemplate }>("kanvas-lyrics-template", {
      action: "patch",
      templateId,
      patch,
    });
  },
  finalize(templateId: string) {
    return call<{ template: LyricTemplate }>("kanvas-lyrics-template", {
      action: "finalize",
      templateId,
    });
  },
  archive(templateId: string) {
    return call<{ template: LyricTemplate }>("kanvas-lyrics-template", {
      action: "archive",
      templateId,
    });
  },
  transcribe(templateId: string, force = false) {
    return call<{ template: LyricTemplate }>("kanvas-lyrics-transcribe", { templateId, force });
  },
};

export async function uploadToBucket(
  bucket: string,
  path: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { contentType, upsert: true, cacheControl: "3600" });
  if (error) throw error;
}

export function msToSec(ms: number): number {
  return ms / 1000;
}
export function secToMs(sec: number): number {
  return Math.round(sec * 1000);
}
