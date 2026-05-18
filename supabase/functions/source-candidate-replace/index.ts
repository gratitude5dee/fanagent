import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { filterByDuration } from "../_shared/sources/filters.ts";
import type { SourceCandidate } from "../_shared/sources/types.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type RequestBody = {
  libraryItemId?: string;
  segmentIndex?: number;
  candidateId?: string;
};

function replaceSegment(segments: unknown[], segmentIndex: number, candidate: SourceCandidate) {
  const next = [...segments];
  next[segmentIndex] = {
    source: candidate.source_type === "library" ? "stock" : candidate.source_type,
    url: candidate.cached_url ?? candidate.origin_url,
    provider: candidate.provider,
    externalId: candidate.external_id,
    durationSec: candidate.duration_seconds,
    reused: false,
  };
  return next;
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST")
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);

  try {
    const body = (await request.json()) as RequestBody;
    if (!body.libraryItemId) throw new Error("libraryItemId is required.");
    if (!Number.isInteger(body.segmentIndex)) throw new Error("segmentIndex is required.");
    if (!body.candidateId) throw new Error("candidateId is required.");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("video_library_items")
      .select("*")
      .eq("id", body.libraryItemId)
      .single();
    if (item.error) throw item.error;

    const candidate = await supabase
      .from("source_candidates")
      .select("*")
      .eq("id", body.candidateId)
      .single();
    if (candidate.error) throw candidate.error;

    const durationCheck = filterByDuration(
      [candidate.data as SourceCandidate],
      Number(item.data.duration_sec ?? candidate.data.duration_seconds),
      5,
      10,
    );
    if (durationCheck.candidates.length === 0) {
      throw new Error("Candidate exceeds duration tolerance for this library item.");
    }

    const segments = Array.isArray(item.data.segments) ? item.data.segments : [];
    const nextSegments = replaceSegment(
      segments,
      body.segmentIndex!,
      candidate.data as SourceCandidate,
    );
    const nextProvenance = nextSegments.map((segment) => {
      const record = (segment ?? {}) as Record<string, unknown>;
      return {
        source_type: record.source ?? "stock",
        provider: record.provider ?? record.source ?? "stock",
        external_id: record.externalId ?? null,
        origin_url: record.url ?? null,
      };
    });

    const updated = await supabase
      .from("video_library_items")
      .update({
        segments: nextSegments,
        provenance: nextProvenance,
        status: "not_ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.libraryItemId)
      .select("*")
      .single();
    if (updated.error) throw updated.error;

    if (item.data.generation_item_id) {
      await supabase.from("render_attempts").insert({
        generation_item_id: item.data.generation_item_id,
        stage: "sourcing",
        status: "succeeded",
        provider: candidate.data.provider,
        detail: {
          action: "source-candidate-replace",
          segment_index: body.segmentIndex,
          candidate_id: body.candidateId,
        },
      });
    }

    return okEnvelope({ library_item: updated.data });
  } catch (error) {
    return errorEnvelope(error, "SOURCE_CANDIDATE_REPLACE_FAILED", 500);
  }
});
