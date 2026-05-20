// Plans segments for a generation_item based on the batch's duration and source
// mode, then fills the `stock` segments with cached stock clip URLs.
// `seedance` segments are left with a prompt and url=null for the seedance worker.
// Writes back to generation_items.segments. Status:
//   - all-stock & filled → "picking_stock" (orchestrator will skip directly to stitch)
//   - mixed/seedance with pending segments → "planning" (orchestrator dispatches seedance)

import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { optionalEnv } from "../_shared/env.ts";
import { createSegmentVisualPlan, normalizeSourceMode } from "../_shared/generation.ts";
import { candidateDedupeKeys, selectUnique } from "../_shared/sources/dedupe.ts";
import { filterByDuration, filterPortrait } from "../_shared/sources/filters.ts";
import {
  assertCandidateInCategory,
  selectClipPool,
} from "../_shared/sources/pool.ts";
import { getSourceAdapter, normalizeSourceType } from "../_shared/sources/registry.ts";
import type {
  DedupeStrategy,
  SourceCandidate,
  SourceSegmentRequest,
  SourceType,
} from "../_shared/sources/types.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { isAuthorizedInternalCall } from "../_shared/internal.ts";

type Segment = {
  source: "stock" | "seedance";
  sourceType?: SourceType | null;
  url?: string;
  prompt?: string;
  provider?: string | null;
  externalId?: string | null;
  candidateId?: string | null;
  query?: string | null;
  durationSec?: number | null;
  toleranceSec?: number | null;
  reused?: boolean | null;
  license?: string | null;
  rightsHolder?: string | null;
  attribution?: string | null;
  storagePath?: string | null;
};

type CandidateSearchEnvelope = {
  data?: {
    candidates?: Record<string, SourceCandidate[]>;
  };
  candidates?: Record<string, SourceCandidate[]>;
  error?: unknown;
  errorDetail?: unknown;
};

function fnUrl(name: string): string {
  return `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
}

async function invokeChild(name: string, body: unknown): Promise<Response> {
  return fetch(fnUrl(name), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": optionalEnv("CRON_SECRET") ?? "",
    },
    body: JSON.stringify(body),
  });
}

function transcriptText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  const transcript = value as Record<string, unknown>;
  const words = Array.isArray(transcript.words) ? transcript.words : [];
  if (words.length > 0) {
    return words
      .map((word) => {
        if (typeof word === "string") return word;
        if (!word || typeof word !== "object") return "";
        const record = word as Record<string, unknown>;
        return String(record.text ?? record.word ?? "");
      })
      .filter(Boolean)
      .join(" ");
  }
  const blocks = Array.isArray(transcript.blocks) ? transcript.blocks : [];
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      return String((block as Record<string, unknown>).text ?? "");
    })
    .filter(Boolean)
    .join(" ");
}

function transcriptSnippet(value: unknown, itemIndex: number, segmentIndex: number): string {
  const words = transcriptText(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const start = (itemIndex * 17 + segmentIndex * 11) % words.length;
  return [...words, ...words].slice(start, start + 14).join(" ");
}

async function searchCandidates(input: {
  audioClipId: string;
  accountId: string;
  segment: SourceSegmentRequest;
  tolerancePreferredSec: number;
  toleranceFallbackSec: number;
  portraitOnly: boolean;
  categoryId?: string | null;
  subcategorySlug?: string | null;
}): Promise<SourceCandidate[]> {
  const response = await invokeChild("source-candidate-search", {
    audioClipId: input.audioClipId,
    accountId: input.accountId,
    tolerancePreferredSec: input.tolerancePreferredSec,
    toleranceFallbackSec: input.toleranceFallbackSec,
    portraitOnly: input.portraitOnly,
    categoryId: input.categoryId ?? null,
    subcategorySlug: input.subcategorySlug ?? null,
    segments: [input.segment],
  });
  const json = (await response.json().catch(() => ({}))) as CandidateSearchEnvelope;
  if (!response.ok) {
    throw new Error(
      `source-candidate-search failed [${response.status}]: ${JSON.stringify(
        json.errorDetail ?? json.error ?? json,
      )}`,
    );
  }
  return (
    json.data?.candidates?.[String(input.segment.segmentIndex)] ??
    json.candidates?.[String(input.segment.segmentIndex)] ??
    []
  );
}

async function loadUsedCandidateKeys(input: {
  accountId: string;
  audioClipId: string;
}): Promise<Set<string>> {
  const supabase = getSupabaseAdmin();
  const used = new Set<string>();
  const byClip = await supabase
    .from("source_candidate_uses")
    .select("source_candidates(*)")
    .eq("audio_clip_id", input.audioClipId);
  if (byClip.error) throw byClip.error;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const byAccount = await supabase
    .from("source_candidate_uses")
    .select("source_candidates(*)")
    .eq("account_id", input.accountId)
    .gte("created_at", thirtyDaysAgo);
  if (byAccount.error) throw byAccount.error;

  for (const row of [...(byClip.data ?? []), ...(byAccount.data ?? [])]) {
    const candidate = (row as { source_candidates?: SourceCandidate | SourceCandidate[] })
      .source_candidates;
    const resolved = Array.isArray(candidate) ? candidate[0] : candidate;
    if (!resolved) continue;
    for (const key of candidateDedupeKeys(resolved)) used.add(key);
  }
  return used;
}

async function recordCandidateUse(input: {
  candidate: SourceCandidate;
  accountId: string;
  audioClipId: string;
  batchId: string;
  generationItemId: string;
  segmentIndex: number;
  reused: boolean;
  toleranceSecondsUsed: number | null;
}): Promise<void> {
  if (!input.candidate.id) return;
  const supabase = getSupabaseAdmin();
  const upsert = await supabase.from("source_candidate_uses").upsert(
    {
      candidate_id: input.candidate.id,
      account_id: input.accountId,
      audio_clip_id: input.audioClipId,
      batch_id: input.batchId,
      generation_item_id: input.generationItemId,
      segment_index: input.segmentIndex,
      reused: input.reused,
      tolerance_seconds_used: input.toleranceSecondsUsed,
    },
    { onConflict: "generation_item_id,segment_index" },
  );
  if (upsert.error) throw upsert.error;
}

function plannedSourceForSegment(sourceMode: string, segmentIndex: number): "stock" | "seedance" {
  if (sourceMode === "seedance" || sourceMode === "gmi_seedance") return "seedance";
  if (sourceMode === "mixed") return segmentIndex % 2 === 0 ? "stock" : "seedance";
  return "stock";
}

function sourceTypeForSearch(sourceMode: string): SourceType {
  if (sourceMode === "sports_edit" || sourceMode === "streamer_clip") return sourceMode;
  return "stock";
}

function buildCandidateSegment(input: {
  candidate: SourceCandidate;
  url: string;
  storagePath?: string | null;
  query: string;
  reused: boolean;
  toleranceSecondsUsed: number | null;
}): Segment {
  return {
    source: "stock",
    sourceType: input.candidate.source_type,
    url: input.url,
    provider: input.candidate.provider,
    externalId: input.candidate.external_id ?? null,
    candidateId: input.candidate.id ?? null,
    query: input.query,
    durationSec: Number(input.candidate.duration_seconds),
    toleranceSec: input.toleranceSecondsUsed,
    reused: input.reused,
    license: input.candidate.license,
    rightsHolder: input.candidate.rights_holder ?? null,
    attribution: input.candidate.attribution ?? null,
    storagePath: input.storagePath ?? input.candidate.storage_path ?? null,
  };
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") {
    return errorEnvelope("Method not allowed", "METHOD_NOT_ALLOWED", 405);
  }
  if (!isAuthorizedInternalCall(request)) {
    return errorEnvelope("Unauthorized internal call.", "UNAUTHORIZED_INTERNAL", 401);
  }

  try {
    const body = (await request.json()) as { itemId?: string };
    if (!body.itemId) throw new Error("itemId is required");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select(
        "id,account_id,batch_id,item_index,prompt,input_payload,duration_seconds,audio_clip_id",
      )
      .eq("id", body.itemId)
      .single();
    if (item.error) throw item.error;

    const batch = await supabase
      .from("generation_batches")
      .select(
        "source_mode,duration_seconds,settings,audio_asset_id,audio_clip_id,dedupe_strategy,duration_tolerance_seconds,duration_tolerance_fallback_seconds",
      )
      .eq("id", item.data.batch_id)
      .single();
    if (batch.error) throw batch.error;

    const audioClipId = item.data.audio_clip_id ?? batch.data.audio_clip_id;
    if (!audioClipId) throw new Error("audio_clip_id is required for source candidate dedupe.");

    const total = Number(item.data.duration_seconds ?? batch.data.duration_seconds ?? 15);
    const segCount = Math.max(1, Math.ceil(total / 15));
    const segmentDuration = Math.max(1, Math.min(15, Math.ceil(total / segCount)));
    const sourceMode = normalizeSourceMode(batch.data.source_mode);

    const prompt = item.data.prompt ?? "music aesthetic vertical";
    const payload = (item.data.input_payload ?? {}) as Record<string, unknown>;
    const batchSettings = (batch.data.settings ?? {}) as Record<string, unknown>;
    const stockSettings = {
      ...((batchSettings.stock ?? {}) as Record<string, unknown>),
      ...((payload.stock_settings ?? {}) as Record<string, unknown>),
      minDurationSec: Math.min(15, total),
    } as Record<string, unknown>;
    const preferredTolerance = Number(batch.data.duration_tolerance_seconds ?? 5);
    const fallbackTolerance = Number(batch.data.duration_tolerance_fallback_seconds ?? 10);
    const dedupeStrategy = String(batch.data.dedupe_strategy ?? "strict") as DedupeStrategy;
    const usedCandidateKeys = await loadUsedCandidateKeys({
      accountId: item.data.account_id,
      audioClipId,
    });

    const audio = batch.data.audio_asset_id
      ? await supabase
          .from("media_assets")
          .select("transcript")
          .eq("id", batch.data.audio_asset_id)
          .maybeSingle()
      : null;
    if (audio?.error) throw audio.error;
    const transcript = audio?.data?.transcript ?? null;

    // Decide source per segment.
    const sources: Array<"stock" | "seedance"> = Array.from({ length: segCount }, (_, i) => {
      return plannedSourceForSegment(sourceMode, i);
    });

    const segments: Segment[] = [];
    for (let segmentIndex = 0; segmentIndex < sources.length; segmentIndex += 1) {
      const src = sources[segmentIndex];
      const visualPlan = createSegmentVisualPlan({
        basePrompt: prompt,
        itemIndex: Number(item.data.item_index ?? 0),
        segmentIndex,
        totalSegments: segCount,
        durationSeconds: segmentDuration,
        transcriptContext: transcriptSnippet(
          transcript,
          Number(item.data.item_index ?? 0),
          segmentIndex,
        ),
      });

      if (src === "stock") {
        const sourceType = sourceTypeForSearch(sourceMode);
        const rawCandidates = await searchCandidates({
          audioClipId,
          accountId: item.data.account_id,
          tolerancePreferredSec: preferredTolerance,
          toleranceFallbackSec: fallbackTolerance,
          portraitOnly: stockSettings.portraitOnly !== false,
          segment: {
            segmentIndex,
            sourceType,
            targetDurationSec: segmentDuration,
            query: visualPlan.query,
            settings: stockSettings,
          },
        });
        const portraitCandidates =
          stockSettings.portraitOnly === false ? rawCandidates : filterPortrait(rawCandidates);
        const durationFiltered = filterByDuration(
          portraitCandidates,
          segmentDuration,
          preferredTolerance,
          fallbackTolerance,
        );
        const selected = selectUnique(
          durationFiltered.candidates,
          usedCandidateKeys,
          dedupeStrategy,
        );

        if (selected) {
          const adapter = getSourceAdapter(normalizeSourceType(selected.candidate.source_type));
          const cached = await adapter.cache(selected.candidate);
          segments.push(
            buildCandidateSegment({
              candidate: selected.candidate,
              url: cached.url,
              storagePath: cached.storage_path,
              query: visualPlan.query,
              reused: selected.reused,
              toleranceSecondsUsed:
                selected.candidate.tolerance_seconds_used ?? durationFiltered.toleranceUsed,
            }),
          );
          await recordCandidateUse({
            candidate: selected.candidate,
            accountId: item.data.account_id,
            audioClipId,
            batchId: item.data.batch_id,
            generationItemId: item.data.id,
            segmentIndex,
            reused: selected.reused,
            toleranceSecondsUsed:
              selected.candidate.tolerance_seconds_used ?? durationFiltered.toleranceUsed,
          });
          for (const key of candidateDedupeKeys(selected.candidate)) usedCandidateKeys.add(key);
          if (cached.url) usedCandidateKeys.add(`url:${cached.url}`);
          continue;
        }

        if (sourceMode === "stock" && !optionalEnv("FAL_KEY")) {
          throw new Error(`No stock candidates for prompt: ${visualPlan.query}`);
        }
      }

      segments.push({
        source: "seedance",
        prompt: visualPlan.prompt,
        query: visualPlan.query,
        durationSec: segmentDuration,
        reused: false,
      });
    }

    const allFilled = segments.every((s) => !!s.url);
    const toleranceValues = segments
      .map((segment) => segment.toleranceSec)
      .filter((value): value is number => typeof value === "number");
    const updated = await supabase
      .from("generation_items")
      .update({
        segments,
        stock_clip_url: segments[0]?.url ?? null,
        duration_tolerance_seconds_used: toleranceValues.length
          ? Math.max(...toleranceValues)
          : null,
        status: allFilled ? "picking_stock" : "planning",
      })
      .eq("id", body.itemId);
    if (updated.error) throw updated.error;

    return okEnvelope({
      itemId: body.itemId,
      segments,
      allFilled,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /No stock candidates|tolerance/i.test(message)
      ? "TOLERANCE_EXCEEDED"
      : "PICK_SOURCE_CLIP_FAILED";
    return errorEnvelope(error, code, 500);
  }
});
