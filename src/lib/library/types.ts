export type LibraryStatus =
  | "all"
  | "not_ready"
  | "ready"
  | "scheduled"
  | "posted"
  | "blocked"
  | "failed"
  | "archived";

export type LibrarySegment = {
  source?: string | null;
  sourceType?: string | null;
  source_type?: string | null;
  url?: string | null;
  provider?: string | null;
  externalId?: string | null;
  external_id?: string | null;
  query?: string | null;
  durationSec?: number | null;
  duration_seconds?: number | null;
  toleranceSec?: number | null;
  tolerance_seconds_used?: number | null;
  reused?: boolean | null;
  prompt?: string | null;
  license?: string | null;
  rightsHolder?: string | null;
  rights_holder?: string | null;
  attribution?: string | null;
};

export type MediaAsset = {
  id: string;
  kind?: string | null;
  source?: string | null;
  public_url?: string | null;
  mime_type?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  duration_sec?: number | null;
  width?: number | null;
  height?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type AudioClip = {
  id: string;
  account_id: string;
  source_asset_id: string;
  trimmed_asset_id: string | null;
  selection_start_sec: number;
  selection_end_sec: number;
  duration_sec: number;
  file_name: string | null;
  perceptual_hash: string | null;
  transcription_status: string;
  default_lyric_template_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type LibraryItem = {
  id: string;
  account_id: string;
  audio_clip_id: string;
  batch_id: string | null;
  generation_item_id: string | null;
  library_index: number;
  status: Exclude<LibraryStatus, "all">;
  final_asset_id: string | null;
  thumbnail_url: string | null;
  duration_sec: number;
  segments: LibrarySegment[];
  provenance: unknown[];
  perceptual_hash: string | null;
  reused_flags: Record<string, unknown>;
  default_caption: string | null;
  default_hashtags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  next_scheduled_at?: string | null;
  media?: MediaAsset | null;
};

export type RegenerateTarget = {
  generationItemId?: string | null;
  libraryItemId?: string | null;
};

export type SourceCandidate = {
  id: string;
  source_type: string;
  provider: string;
  external_id: string | null;
  origin_url: string;
  cached_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number;
  is_portrait: boolean;
  license: string;
  attribution: string | null;
  score?: number;
};
