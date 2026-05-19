import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { optionalEnv } from "../_shared/env.ts";
import {
  buildLibrarySegmentReplacement,
  segmentTargetDurationSeconds,
} from "../_shared/library.ts";
import { filterByDuration } from "../_shared/sources/filters.ts";
import { getSourceAdapter, normalizeSourceType } from "../_shared/sources/registry.ts";
import type { SourceCandidate } from "../_shared/sources/types.ts";
import { withRenderAttempt } from "../_shared/render-attempts.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type RequestBody = {
  action?: "searchCandidates" | "replace";
  libraryItemId?: string;
  segmentIndex?: number;
  candidateId?: string;
  sourceType?: string;
  query?: string;
  targetDurationSec?: number;
  settings?: Record<string, unknown>;
};

type CandidateSearchEnvelope = {
  data?: {
    candidates?: Record<string, SourceCandidate[]>;
  };
  candidates?: Record<string, SourceCandidate[]>;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function fnUrl(name: string): string {
  return `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
}

async function invokeChild(name: string, body: unknown): Promise<unknown> {
  const response = await fetch(fnUrl(name), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": optionalEnv("CRON_SECRET") ?? "",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${name} failed [${response.status}]: ${JSON.stringify(json)}`);
  }
  return json;
}

async function recordCandidateUse(input: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  candidate: SourceCandidate;
  item: Record<string, unknown>;
  libraryItem: Record<string, unknown>;
  segmentIndex: number;
  toleranceSecondsUsed: number | null;
}): Promise<void> {
  if (!input.candidate.id) return;
  const upsert = await input.supabase.from("source_candidate_uses").upsert(
    {
      candidate_id: input.candidate.id,
      account_id: input.libraryItem.account_id,
      audio_clip_id: input.libraryItem.audio_clip_id,
      batch_id: input.libraryItem.batch_id ?? input.item.batch_id,
      generation_item_id: input.item.id,
      segment_index: input.segmentIndex,
      reused: false,
      tolerance_seconds_used: input.toleranceSecondsUsed,
    },
    { onConflict: "generation_item_id,segment_index" },
  );
  if (upsert.error) throw upsert.error;
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

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("video_library_items")
      .select("*")
      .eq("id", body.libraryItemId)
      .single();
    if (item.error) throw item.error;
    if (!item.data.generation_item_id) {
      throw new Error("Library item is not linked to a generation item.");
    }

    const generationItem = await supabase
      .from("generation_items")
      .select(
        "id,account_id,batch_id,segments,duration_seconds,audio_clip_id,library_item_id,status",
      )
      .eq("id", item.data.generation_item_id)
      .single();
    if (generationItem.error) throw generationItem.error;

    const currentSegments = Array.isArray(generationItem.data.segments)
      ? generationItem.data.segments
      : Array.isArray(item.data.segments)
        ? item.data.segments
        : [];
    if (currentSegments.length === 0) {
      throw new Error("Library item has no segment list to replace.");
    }
    const targetDurationSec = segmentTargetDurationSeconds({
      segment: currentSegments[body.segmentIndex!],
      segmentCount: currentSegments.length,
      libraryDurationSec: Number(
        item.data.duration_sec ?? generationItem.data.duration_seconds ?? 15,
      ),
    });

    if (body.action === "searchCandidates") {
      const currentSegment = record(currentSegments[body.segmentIndex!]);
      const audioClipId = String(item.data.audio_clip_id ?? generationItem.data.audio_clip_id ?? "");
      const accountId = String(item.data.account_id ?? generationItem.data.account_id ?? "");
      if (!audioClipId) throw new Error("Library item is missing audio_clip_id.");
      const sourceType = normalizeSourceType(
        body.sourceType ??
          currentSegment.sourceType ??
          currentSegment.source_type ??
          currentSegment.source,
      );
      const query = String(body.query ?? currentSegment.query ?? currentSegment.prompt ?? "");
      const searched = (await invokeChild("source-candidate-search", {
        audioClipId,
        accountId,
        portraitOnly: true,
        segments: [
          {
            segmentIndex: body.segmentIndex,
            sourceType,
            query,
            targetDurationSec: Number(body.targetDurationSec ?? targetDurationSec),
            settings: body.settings ?? { perAdapterLimit: 12 },
          },
        ],
      })) as CandidateSearchEnvelope;
      return okEnvelope({
        candidates:
          searched.data?.candidates?.[String(body.segmentIndex)] ??
          searched.candidates?.[String(body.segmentIndex)] ??
          [],
        targetDurationSec,
      });
    }

    if (!body.candidateId) throw new Error("candidateId is required.");

    const candidate = await supabase
      .from("source_candidates")
      .select("*")
      .eq("id", body.candidateId)
      .single();
    if (candidate.error) throw candidate.error;
    const sourceCandidate = candidate.data as SourceCandidate;

    const durationCheck = filterByDuration([sourceCandidate], targetDurationSec, 5, 10);
    if (durationCheck.candidates.length === 0) {
      throw new Error("Candidate exceeds duration tolerance for this library item.");
    }

    const adapter = getSourceAdapter(normalizeSourceType(sourceCandidate.source_type));
    const cached = await adapter.cache(sourceCandidate);
    const toleranceSecondsUsed =
      sourceCandidate.tolerance_seconds_used ?? durationCheck.toleranceUsed;
    const replacement = buildLibrarySegmentReplacement({
      segments: currentSegments,
      segmentIndex: body.segmentIndex!,
      candidate: sourceCandidate,
      cachedUrl: cached.url,
      storagePath: cached.storage_path,
      libraryDurationSec: Number(
        item.data.duration_sec ?? generationItem.data.duration_seconds ?? 15,
      ),
      toleranceSecondsUsed,
    });

    await recordCandidateUse({
      supabase,
      candidate: sourceCandidate,
      item: generationItem.data,
      libraryItem: item.data,
      segmentIndex: body.segmentIndex!,
      toleranceSecondsUsed,
    });

    await withRenderAttempt(
      {
        generationItemId: item.data.generation_item_id,
        stage: "sourcing",
        provider: sourceCandidate.provider,
        detail: {
          action: "source-candidate-replace",
          segment_index: body.segmentIndex,
          candidate_id: body.candidateId,
        },
      },
      async () => ({ replaced: true }),
    );

    const toleranceValues = replacement.segments
      .map((segment) => segment.toleranceSec)
      .filter((value): value is number => typeof value === "number");
    const generationUpdate = await supabase
      .from("generation_items")
      .update({
        segments: replacement.segments,
        stock_clip_url: null,
        final_asset_id: null,
        status: "picking_stock",
        duration_tolerance_seconds_used: toleranceValues.length
          ? Math.max(...toleranceValues)
          : toleranceSecondsUsed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.data.generation_item_id);
    if (generationUpdate.error) throw generationUpdate.error;

    const updated = await supabase
      .from("video_library_items")
      .update({
        segments: replacement.segments,
        provenance: replacement.provenance,
        status: "not_ready",
        final_asset_id: null,
        thumbnail_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.libraryItemId)
      .select("*")
      .single();
    if (updated.error) throw updated.error;

    const stitch = await invokeChild("stitch-segments", { itemId: item.data.generation_item_id });
    const render = await invokeChild("render-karaoke", { itemId: item.data.generation_item_id });

    const finalized = await supabase
      .from("video_library_items")
      .select("*")
      .eq("id", body.libraryItemId)
      .single();
    if (finalized.error) throw finalized.error;

    return okEnvelope({ library_item: finalized.data, replaced: updated.data, stitch, render });
  } catch (error) {
    return errorEnvelope(error, "SOURCE_CANDIDATE_REPLACE_FAILED", 500);
  }
});
