export type SourceType =
  | "stock"
  | "library"
  | "seedance"
  | "gmi_seedance"
  | "sports_edit"
  | "streamer_clip";

export type DedupeStrategy = "strict" | "allow_reuse_after_exhaustion" | "allow_reuse_freely";

export type SourceLicense =
  | "pexels"
  | "pixabay"
  | "user_library"
  | "generated_seedance"
  | "generated_gmi_seedance"
  | "youtube_owner_provided"
  | "twitch_creator_rights"
  | "unknown";

export const allowedSourceLicenses: SourceLicense[] = [
  "pexels",
  "pixabay",
  "user_library",
  "generated_seedance",
  "generated_gmi_seedance",
  "youtube_owner_provided",
  "twitch_creator_rights",
  "unknown",
];

export function isAllowedSourceLicense(value: unknown): value is SourceLicense {
  return allowedSourceLicenses.includes(value as SourceLicense);
}

export type AdapterSearchInput = {
  accountId: string;
  audioClipId: string;
  query: string;
  targetDurationSec: number;
  tolerancePreferredSec: number;
  toleranceFallbackSec: number;
  portraitOnly: boolean;
  keywords?: string[];
  negativeKeywords?: string[];
  category?: string;
  mood?: string;
  perAdapterLimit?: number;
  adapterSettings?: Record<string, unknown>;
};

export type SourceCandidate = {
  id?: string;
  account_id?: string | null;
  source_type: SourceType;
  provider: string;
  external_id?: string | null;
  origin_url: string;
  cached_url?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  width?: number | null;
  height?: number | null;
  duration_seconds: number;
  is_portrait: boolean;
  perceptual_hash?: string | null;
  license: SourceLicense;
  rights_holder?: string | null;
  attribution?: string | null;
  expires_at?: string | null;
  metadata?: Record<string, unknown>;
  score?: number;
  tolerance_seconds_used?: number | null;
};

export interface SourceAdapter {
  type: SourceType;
  search(input: AdapterSearchInput): Promise<SourceCandidate[]>;
  cache(candidate: SourceCandidate): Promise<{ url: string; storage_path?: string | null }>;
  describeLicense(candidate: SourceCandidate): {
    license: SourceLicense;
    rights_holder?: string | null;
    attribution?: string | null;
  };
}

export type SourceSegmentRequest = {
  segmentIndex: number;
  sourceType?: SourceType;
  targetDurationSec: number;
  query: string;
  settings?: Record<string, unknown>;
};
