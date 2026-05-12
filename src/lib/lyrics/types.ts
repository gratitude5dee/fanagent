// Lyrics Template Builder — shared types.
// UI uses seconds; API/database boundaries use milliseconds.

export type WizardStep = 1 | 2 | 3;
export type AppState = "upload" | "trim" | "lyrics_edit" | "lyrics_complete" | "markers_edit";
export type ClipDuration = 15 | 30 | 45 | 60;
export type TranscribeStatus =
  | "idle"
  | "uploading"
  | "transcribing"
  | "parsing"
  | "ready"
  | "failed";

export interface AudioData {
  fileName: string | null;
  fileUrl: string | null;
  totalDuration: number;
  selectionStart: number;
  selectionDuration: ClipDuration;
  zoom: number;
  confirmed: boolean;
  peaks: number[];
}

export interface LyricWord {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

export interface LyricBlock {
  id: string;
  label: string;
  startTime: number;
  endTime: number;
  words: LyricWord[];
}

export interface CutMarker {
  id: string;
  timestamp: number;
}

export type TemplateStatus =
  | "draft"
  | "audio_ready"
  | "lyrics_processing"
  | "lyrics_ready"
  | "markers_ready"
  | "saved"
  | "failed"
  | "archived";

export interface LyricTemplate {
  id: string;
  user_id: string;
  title: string;
  status: TemplateStatus;
  source_audio_asset_id: string | null;
  trimmed_audio_asset_id: string | null;
  selection_start_ms: number;
  selection_duration_ms: number;
  total_duration_ms: number;
  waveform_peaks: number[];
  lyric_blocks: LyricBlock[];
  cut_markers: number[]; // ms
  transcript_meta: Record<string, unknown>;
  render_defaults: Record<string, unknown>;
  error_message: string | null;
  saved_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export const ALLOWED_AUDIO_MIME = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/x-flac",
  "audio/ogg",
];
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

export function statusToStep(status: TemplateStatus): WizardStep {
  if (status === "draft") return 1;
  if (status === "audio_ready" || status === "lyrics_processing" || status === "failed") return 2;
  if (status === "lyrics_ready") return 3;
  return 3;
}
