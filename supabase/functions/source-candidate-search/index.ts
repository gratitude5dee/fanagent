import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { isAuthorizedInternalCall } from "../_shared/internal.ts";
import { normalizeSourceType, searchSourceCandidates } from "../_shared/sources/registry.ts";
import {
  isAllowedSourceLicense,
  type SourceCandidate,
  type SourceSegmentRequest,
} from "../_shared/sources/types.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type RequestBody = {
  audioClipId?: string;
  accountId?: string;
  segments?: SourceSegmentRequest[];
  tolerancePreferredSec?: number;
  toleranceFallbackSec?: number;
  portraitOnly?: boolean;
  categoryId?: string | null;
  subcategorySlug?: string | null;
};

function candidateRow(input: {
  candidate: SourceCandidate;
  accountId: string;
  categoryId?: string | null;
  subcategorySlug?: string | null;
}): Record<string, unknown> {
  assertCandidateRights(input.candidate);
  return {
    account_id: input.accountId,
    source_type: input.candidate.source_type,
    provider: input.candidate.provider,
    external_id: input.candidate.external_id ?? input.candidate.origin_url,
    origin_url: input.candidate.origin_url,
    cached_url: input.candidate.cached_url ?? null,
    storage_bucket: input.candidate.storage_bucket ?? null,
    storage_path: input.candidate.storage_path ?? null,
    width: input.candidate.width ?? null,
    height: input.candidate.height ?? null,
    duration_seconds: input.candidate.duration_seconds,
    is_portrait: input.candidate.is_portrait,
    perceptual_hash: input.candidate.perceptual_hash ?? null,
    license: input.candidate.license,
    rights_holder: input.candidate.rights_holder ?? null,
    attribution: input.candidate.attribution ?? null,
    expires_at: input.candidate.expires_at ?? null,
    metadata: input.candidate.metadata ?? {},
    category_id: input.categoryId ?? input.candidate.category_id ?? null,
    subcategory_slug: input.subcategorySlug ?? input.candidate.subcategory_slug ?? null,
  };
}

function assertCandidateRights(candidate: SourceCandidate): void {
  if (!isAllowedSourceLicense(candidate.license)) {
    throw new Error(`Unsupported source candidate license: ${candidate.license}`);
  }
  if (
    (candidate.source_type === "sports_edit" || candidate.source_type === "streamer_clip") &&
    !candidate.attribution
  ) {
    throw new Error(`${candidate.source_type} candidates require attribution.`);
  }
}

async function upsertCandidates(
  candidates: SourceCandidate[],
  accountId: string,
  categoryId?: string | null,
  subcategorySlug?: string | null,
): Promise<SourceCandidate[]> {
  if (candidates.length === 0) return [];
  const supabase = getSupabaseAdmin();
  const rows = candidates.map((candidate) =>
    candidateRow({ candidate, accountId, categoryId, subcategorySlug }),
  );
  const inserted = await supabase
    .from("source_candidates")
    .upsert(rows, { onConflict: "source_type,provider,external_id" })
    .select("*");
  if (inserted.error) throw inserted.error;
  return (inserted.data ?? []).map((row, index) => ({
    ...candidates[index],
    ...row,
    score: candidates[index]?.score ?? 0,
  })) as SourceCandidate[];
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST")
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);
  if (!isAuthorizedInternalCall(request)) {
    return errorEnvelope("Unauthorized internal call.", "UNAUTHORIZED_INTERNAL", 401);
  }

  try {
    const body = (await request.json()) as RequestBody;
    if (!body.audioClipId) throw new Error("audioClipId is required.");
    if (!Array.isArray(body.segments) || body.segments.length === 0) {
      throw new Error("segments are required.");
    }

    const supabase = getSupabaseAdmin();
    const clip = await supabase
      .from("audio_clips")
      .select("id,account_id")
      .eq("id", body.audioClipId)
      .single();
    if (clip.error) throw clip.error;
    const accountId = body.accountId ?? clip.data.account_id;

    const bySegment: Record<string, SourceCandidate[]> = {};
    for (const segment of body.segments) {
      const sourceType = normalizeSourceType(segment.sourceType);
      const candidates = await searchSourceCandidates(sourceType, {
        accountId,
        audioClipId: body.audioClipId,
        query: segment.query,
        targetDurationSec: segment.targetDurationSec,
        tolerancePreferredSec: body.tolerancePreferredSec ?? 5,
        toleranceFallbackSec: body.toleranceFallbackSec ?? 10,
        portraitOnly: body.portraitOnly ?? true,
        adapterSettings: segment.settings,
        perAdapterLimit: Number(segment.settings?.perAdapterLimit ?? 20),
        categoryId: body.categoryId ?? null,
        subcategorySlug: body.subcategorySlug ?? null,
      });
      bySegment[String(segment.segmentIndex)] = await upsertCandidates(
        candidates,
        accountId,
        body.categoryId ?? null,
        body.subcategorySlug ?? null,
      );
    }

    return okEnvelope({ candidates: bySegment });
  } catch (error) {
    return errorEnvelope(error, "SOURCE_CANDIDATE_SEARCH_FAILED", 500);
  }
});
