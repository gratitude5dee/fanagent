import { getSupabaseAdmin } from "../supabase.ts";
import type { SourceAdapter, SourceCandidate } from "./types.ts";

export const libraryAdapter: SourceAdapter = {
  type: "library",
  async search(input) {
    const supabase = getSupabaseAdmin();
    const rows = await supabase
      .from("media_assets")
      .select("id,public_url,duration_seconds,metadata")
      .in("kind", ["source_video", "stock_video", "rendered_video"])
      .eq("account_id", input.accountId)
      .limit(input.perAdapterLimit ?? 20);
    if (rows.error) throw rows.error;

    return (rows.data ?? []).map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const width = Number(metadata.width ?? 1080);
      const height = Number(metadata.height ?? 1920);
      return {
        source_type: "library",
        provider: "library",
        external_id: row.id,
        origin_url: row.public_url,
        width,
        height,
        duration_seconds: Number(row.duration_seconds ?? input.targetDurationSec),
        is_portrait: height > width,
        perceptual_hash:
          typeof metadata.perceptual_hash === "string" ? metadata.perceptual_hash : null,
        license: "user_library",
        metadata,
        score: 0.75,
      } satisfies SourceCandidate;
    });
  },
  async cache(candidate) {
    return {
      url: candidate.cached_url ?? candidate.origin_url,
      storage_path: candidate.storage_path,
    };
  },
  describeLicense(candidate) {
    return { license: candidate.license, attribution: candidate.attribution };
  },
};
