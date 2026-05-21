// User-facing campaign API for the autopilot wizard. Single function,
// dispatched by `action`, to keep the frontend wiring simple.
//
// Actions:
//   list                                → all batches + items for the primary account
//   create   { audioBase64, sourceMode, postCount, cadenceMinutes, prompt }
//                                       → wraps create-generation-batch
//   pause    { batchId }                → marks batch paused_at = now()
//   resume   { batchId }                → clears paused_at
//   cancel   { batchId }                → stops remaining queued work without schema changes
//   skip     { itemId }                 → marks item skipped
//   regenerate { itemId }              → resets item to pending so the worker reruns it
//   markLibraryItemUnfit { libraryItemId, reason? }
//                                       → blocks a library item and skips not-posted linked posts
//   recoverRecentFailures { since, limit, includeFailed, includeStaleActive }
//                                       → bulk-reset recent failed/stale unposted items

import { handleOptions } from "../_shared/cors.ts";
import {
  buildCampaignCreateBatchPayload,
  normalizeCampaignCreateResponse,
} from "../_shared/campaign.ts";
import { okEnvelope, errorEnvelope, unwrapEnvelopeData } from "../_shared/envelope.ts";
import { optionalEnv } from "../_shared/env.ts";
import { createRegenerationReset, validateTemplateForRender } from "../_shared/generation.ts";
import { buildLibraryUnfitUpdate } from "../_shared/library.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function childError(json: unknown, fallback: string): unknown {
  const data = record(json);
  return data.errorDetail ?? data.error ?? data.message ?? fallback;
}

function maybeId(value: unknown): string | null {
  const data = record(value);
  const id = data.id;
  return typeof id === "string" && id ? id : null;
}

function countTemplateWords(blocks: unknown): number {
  if (!Array.isArray(blocks)) return 0;
  return blocks.reduce((sum, block) => {
    const data = record(block);
    const words = Array.isArray(data.words) ? data.words : [];
    return sum + words.length;
  }, 0);
}

function summarizeLyricTemplates(rows: unknown[]): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const template = record(row);
    const cutMarkers = Array.isArray(template.cut_markers) ? template.cut_markers : [];
    return {
      id: template.id,
      title: template.title,
      status: template.status,
      audio_clip_id: template.audio_clip_id ?? null,
      trimmed_audio_asset_id: template.trimmed_audio_asset_id ?? null,
      total_duration_ms: template.total_duration_ms,
      selection_duration_ms: template.selection_duration_ms,
      word_count: countTemplateWords(template.lyric_blocks),
      cut_marker_count: cutMarkers.length,
      updated_at: template.updated_at,
    };
  });
}

type SchemaCheck = {
  ok: boolean;
  error: string | null;
  transient?: boolean;
};

type BucketNameResult = {
  names: Set<string>;
  error: string | null;
};

type TimedResult<T> = { ok: true; value: T } | { ok: false; error: string };
type SupabaseResult<T> = { data: T | null; error: unknown };

const DIAGNOSTIC_SCHEMA_TIMEOUT_MS = 10_000;
const DIAGNOSTIC_DATA_TIMEOUT_MS = 10_000;
const DIAGNOSTIC_STORAGE_TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clipDiagnosticString(value: string, maxLength = 1200): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return clipDiagnosticString(value);
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => sanitizeDiagnosticValue(item, depth + 1));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      sanitizeDiagnosticValue(nested, depth + 1),
    ]),
  );
}

function schemaErrorMessage(error: unknown): string | null {
  const data = record(error);
  const message = data.message ?? data.error_description ?? data.error;
  return typeof message === "string" && message.trim() ? message : error ? String(error) : null;
}

function isTransientSchemaError(message: string): boolean {
  return /\b(408|409|429|500|502|503|504|520|522|524|525|timeout|temporar|network|ssl handshake|cloudflare|connection reset|fetch failed)\b/i.test(
    message,
  );
}

async function withTimeout<T>(
  label: string,
  promise: PromiseLike<T>,
  timeoutMs = 5000,
): Promise<TimedResult<T>> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise)
        .then((value) => ({ ok: true as const, value }))
        .catch((error) => ({
          ok: false as const,
          error: schemaErrorMessage(error) ?? String(error),
        })),
      new Promise<TimedResult<T>>((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({ ok: false, error: `${label} timed out after ${timeoutMs}ms` });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function queryWithTimeout<T>(
  label: string,
  query: PromiseLike<SupabaseResult<T>>,
  fallbackData: T | null,
  timeoutMs = DIAGNOSTIC_DATA_TIMEOUT_MS,
): Promise<SupabaseResult<T>> {
  const result = await withTimeout(label, query, timeoutMs);
  if (result.ok) return result.value;
  return { data: fallbackData, error: { message: result.error } };
}

async function checkSchema(
  label: string,
  query: () => PromiseLike<{ error: unknown }>,
  attempts = 2,
  timeoutMs = DIAGNOSTIC_SCHEMA_TIMEOUT_MS,
): Promise<SchemaCheck> {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await withTimeout(label, query(), timeoutMs);
    const message = result.ok ? schemaErrorMessage(result.value.error) : result.error;
    if (!message) return { ok: true, error: null };
    lastError = message;
    if (!isTransientSchemaError(message) || attempt === attempts - 1) break;
    await sleep(150 * (attempt + 1));
  }
  if (lastError && isTransientSchemaError(lastError)) {
    return { ok: true, error: lastError, transient: true };
  }
  return { ok: false, error: lastError, transient: false };
}

async function loadStorageBucketNames(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  expectedBuckets: string[],
): Promise<BucketNameResult> {
  const listed = await queryWithTimeout(
    "storage.listBuckets",
    supabase.storage.listBuckets(),
    [],
    DIAGNOSTIC_STORAGE_TIMEOUT_MS,
  );
  if (!listed.error && (listed.data ?? []).length > 0) {
    return {
      names: new Set((listed.data ?? []).map((bucket) => bucket.name)),
      error: null,
    };
  }

  const listError =
    schemaErrorMessage(listed.error) ??
    (listed.data?.length === 0 ? "storage.listBuckets returned no buckets" : null);
  const bucketChecks = await Promise.all(
    expectedBuckets.map(async (name) => {
      const bucket = await queryWithTimeout(
        `storage.getBucket(${name})`,
        supabase.storage.getBucket(name),
        null,
        DIAGNOSTIC_STORAGE_TIMEOUT_MS,
      );
      return {
        name,
        ok: !bucket.error,
        error: schemaErrorMessage(bucket.error),
      };
    }),
  );
  const checkedNames = new Set(
    bucketChecks.filter((bucket) => bucket.ok).map((bucket) => bucket.name),
  );
  if (checkedNames.size > 0) {
    const checkErrors = bucketChecks
      .filter((bucket) => !bucket.ok && bucket.error)
      .map((bucket) => `${bucket.name}: ${bucket.error}`);
    return {
      names: checkedNames,
      error: [listError, ...checkErrors].filter(Boolean).join("; ") || null,
    };
  }

  const queried = await queryWithTimeout(
    "storage.buckets",
    supabase.schema("storage").from("buckets").select("id,name").in("id", expectedBuckets),
    [],
    DIAGNOSTIC_STORAGE_TIMEOUT_MS,
  );
  if (!queried.error) {
    const rows = (queried.data ?? []) as Array<{ id?: string; name?: string }>;
    return {
      names: new Set(rows.map((bucket) => bucket.name ?? bucket.id).filter(Boolean) as string[]),
      error: listError,
    };
  }

  const queryError = schemaErrorMessage(queried.error);
  return {
    names: new Set(),
    error: [listError, queryError].filter(Boolean).join("; ") || "Unable to check storage buckets",
  };
}

async function callChild(name: string, body: unknown): Promise<Response> {
  const url = `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
  const cronSecret = optionalEnv("CRON_SECRET") ?? "";
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": cronSecret,
    },
    body: JSON.stringify(body),
  });
}

async function callWorker(name: string, body: unknown): Promise<Response> {
  const url = `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
  const cronSecret = optionalEnv("CRON_SECRET") ?? "";
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": cronSecret,
    },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") {
    return errorEnvelope("Method not allowed", "METHOD_NOT_ALLOWED", 405);
  }

  try {
    const supabase = getSupabaseAdmin();
    const body = (await request.json()) as { action?: string } & Record<string, unknown>;
    const action = body.action;

    switch (action) {
      case "list": {
        const [account, batches, items, posts, lyricTemplates] = await Promise.all([
          queryWithTimeout(
            "list primary TikTok account",
            supabase
              .from("accounts")
              .select(
                "id,platform,handle,status,is_primary,tiktok_connected_at,tiktok_display_name",
              )
              .eq("platform", "tiktok")
              .eq("is_primary", true)
              .maybeSingle(),
            null,
          ),
          queryWithTimeout(
            "list generation_batches",
            supabase
              .from("generation_batches")
              .select(
                "id,account_id,source_mode,status,post_count,cadence_minutes,paused_at,completed_at,created_at,prompt,lyric_template_id",
              )
              .order("created_at", { ascending: false })
              .limit(25),
            [],
          ),
          queryWithTimeout(
            "list generation_items",
            supabase
              .from("generation_items")
              .select(
                "id,account_id,batch_id,item_index,library_item_id,status,scheduled_at,provider,prompt,segments,stock_clip_url,render_provider,error_message,lyric_template_id,stage_events",
              )
              .order("scheduled_at", { ascending: true })
              .limit(200),
            [],
          ),
          queryWithTimeout(
            "list posts",
            supabase
              .from("posts")
              .select(
                "id,batch_id,generation_item_id,library_item_id,caption,status,publish_status,scheduled_at,video_url",
              )
              .order("scheduled_at", { ascending: true })
              .limit(200),
            [],
          ),
          queryWithTimeout(
            "list lyric templates",
            supabase
              .from("kanvas_lyric_templates")
              .select(
                "id,title,status,audio_clip_id,trimmed_audio_asset_id,total_duration_ms,selection_duration_ms,lyric_blocks,cut_markers,updated_at",
              )
              .is("archived_at", null)
              .order("updated_at", { ascending: false })
              .limit(100),
            [],
          ),
        ]);
        const warnings = [
          account.error ? `account: ${schemaErrorMessage(account.error)}` : null,
          batches.error ? `batches: ${schemaErrorMessage(batches.error)}` : null,
          items.error ? `items: ${schemaErrorMessage(items.error)}` : null,
          posts.error ? `posts: ${schemaErrorMessage(posts.error)}` : null,
          lyricTemplates.error
            ? `lyricTemplates: ${schemaErrorMessage(lyricTemplates.error)}`
            : null,
        ].filter(Boolean);
        return okEnvelope({
          account: account.data ?? null,
          batches: batches.data ?? [],
          items: items.data ?? [],
          posts: posts.data ?? [],
          lyricTemplates: summarizeLyricTemplates((lyricTemplates.data ?? []) as unknown[]),
          warnings,
        });
      }

      case "diagnostics": {
        const envStatus = {
          supabaseUrl: !!optionalEnv("SUPABASE_URL"),
          serviceRole: !!optionalEnv("SUPABASE_SERVICE_ROLE_KEY"),
          cronSecret: !!optionalEnv("CRON_SECRET"),
          tiktokClientKey: !!optionalEnv("TIKTOK_CLIENT_KEY"),
          tiktokClientSecret: !!optionalEnv("TIKTOK_CLIENT_SECRET"),
          tiktokRedirectUri: !!optionalEnv("TIKTOK_REDIRECT_URI"),
          tokenEncryptionKey: !!optionalEnv("TOKEN_ENCRYPTION_KEY"),
          pexels: !!optionalEnv("PEXELS_API_KEY"),
          pixabay: !!optionalEnv("PIXABAY_API_KEY"),
          fal: !!optionalEnv("FAL_KEY"),
          gmi: !!(optionalEnv("GMI_API_KEY") ?? optionalEnv("GMI_CLOUD_API_KEY")),
          elevenLabs: !!optionalEnv("ELEVENLABS_API_KEY"),
          lovable: !!optionalEnv("LOVABLE_API_KEY"),
          twitchClientId: !!optionalEnv("TWITCH_CLIENT_ID"),
          twitchClientSecret: !!optionalEnv("TWITCH_CLIENT_SECRET"),
          youtubeApiKey: !!optionalEnv("YOUTUBE_API_KEY"),
          sportsAllowed: !!optionalEnv("SPORTS_EDITS_ALLOWED_CHANNELS"),
          streamerAllowed: !!optionalEnv("STREAMER_CLIP_ALLOWED_CHANNELS"),
        };

        const expectedBuckets = [
          "post-assets",
          "stock-cache",
          "audio-uploads",
          "renders",
          "thumbnails",
        ];
        const storageBucketsPromise = loadStorageBucketNames(supabase, expectedBuckets);
        const schemaChecksPromise = Promise.all([
          checkSchema("generation_batches", () =>
            supabase.from("generation_batches").select("settings,publish_defaults").limit(0),
          ),
          checkSchema("generation_items", () =>
            supabase
              .from("generation_items")
              .select("attempt_count,locked_at,stage_events")
              .limit(0),
          ),
          checkSchema("worker_runs", () => supabase.from("worker_runs").select("id").limit(0)),
          checkSchema("audio_clips", () =>
            supabase.from("audio_clips").select("id,transcription_status,duration_sec").limit(0),
          ),
          checkSchema("video_library_items", () =>
            supabase.from("video_library_items").select("id,status,final_asset_id").limit(0),
          ),
          checkSchema("source_candidates", () =>
            supabase.from("source_candidates").select("id,source_type,provider").limit(0),
          ),
          checkSchema("source_candidate_uses", () =>
            supabase
              .from("source_candidate_uses")
              .select("id,candidate_id,generation_item_id")
              .limit(0),
          ),
          checkSchema("render_attempts", () =>
            supabase.from("render_attempts").select("id,stage,status").limit(0),
          ),
          checkSchema("post_schedule_slots", () =>
            supabase.from("post_schedule_slots").select("id,account_id,rule").limit(0),
          ),
        ]);
        const recentWorkerRunsPromise = queryWithTimeout(
          "recent worker_runs",
          supabase
            .from("worker_runs")
            .select("function_name,started_at,ended_at,items_processed,errors_count,detail")
            .order("started_at", { ascending: false })
            .limit(10),
          [],
        );
        const recentFailedItemsPromise = queryWithTimeout(
          "recent failed generation_items",
          supabase
            .from("generation_items")
            .select("id,status,provider,error_message,updated_at")
            .eq("status", "failed")
            .order("updated_at", { ascending: false })
            .limit(50),
          [],
        );
        const queueRowsPromise = queryWithTimeout(
          "generation item queue counts",
          supabase.from("generation_items").select("status").limit(5000),
          [],
        );
        const blockedPublishRowsPromise = queryWithTimeout(
          "blocked publish counts",
          supabase
            .from("posts")
            .select("publish_status")
            .like("publish_status", "blocked_%")
            .limit(5000),
          [],
        );
        const accountRowPromise = queryWithTimeout(
          "primary TikTok account",
          supabase
            .from("accounts")
            .select("id,platform,handle,tiktok_connected_at,tiktok_creator_info,is_primary")
            .eq("platform", "tiktok")
            .eq("is_primary", true)
            .maybeSingle(),
          null,
        );
        const [
          storageBuckets,
          schemaChecks,
          recentWorkerRuns,
          recentFailedItems,
          queueRows,
          blockedPublishRows,
          accountRow,
        ] = await Promise.all([
          storageBucketsPromise,
          schemaChecksPromise,
          recentWorkerRunsPromise,
          recentFailedItemsPromise,
          queueRowsPromise,
          blockedPublishRowsPromise,
          accountRowPromise,
        ]);
        const bucketNames = storageBuckets.names;
        const queueCounts = (queueRows.data ?? []).reduce<Record<string, number>>((acc, row) => {
          const status = String((row as { status?: string }).status ?? "unknown");
          acc[status] = (acc[status] ?? 0) + 1;
          return acc;
        }, {});
        const blockedPublishCounts = (blockedPublishRows.data ?? []).reduce<Record<string, number>>(
          (acc, row) => {
            const status = String((row as { publish_status?: string }).publish_status ?? "");
            if (status) acc[status] = (acc[status] ?? 0) + 1;
            return acc;
          },
          {},
        );
        const workerRuns = (recentWorkerRuns.data ?? []).map((run) => ({
          ...run,
          detail: sanitizeDiagnosticValue(run.detail),
        }));
        const failedItems = recentFailedItems.data ?? [];
        const schemaErrors = schemaChecks
          .filter((check) => check.error && !check.transient)
          .map((check) => check.error);
        const schemaWarnings = schemaChecks
          .filter((check) => check.error && check.transient)
          .map((check) => check.error);
        const dataErrors = [
          recentWorkerRuns.error
            ? `recent worker_runs: ${schemaErrorMessage(recentWorkerRuns.error)}`
            : null,
          recentFailedItems.error
            ? `recent failed generation_items: ${schemaErrorMessage(recentFailedItems.error)}`
            : null,
          queueRows.error
            ? `generation item queue counts: ${schemaErrorMessage(queueRows.error)}`
            : null,
          blockedPublishRows.error
            ? `blocked publish counts: ${schemaErrorMessage(blockedPublishRows.error)}`
            : null,
          accountRow.error
            ? `primary TikTok account: ${schemaErrorMessage(accountRow.error)}`
            : null,
        ].filter(Boolean);
        const latestWorkerRun = workerRuns[0] ?? null;
        const hasCurrentWorkerProblem =
          failedItems.length > 0 || Number(latestWorkerRun?.errors_count ?? 0) > 0;
        const lastWorkerError = hasCurrentWorkerProblem
          ? (workerRuns.find((run) => Number(run.errors_count ?? 0) > 0)?.detail ?? null)
          : null;
        const accountData = accountRow.data as {
          id: string;
          platform: string;
          handle: string | null;
          tiktok_connected_at: string | null;
          tiktok_creator_info: Record<string, unknown> | null;
        } | null;

        return okEnvelope({
          env: envStatus,
          buckets: expectedBuckets.map((name) => ({
            name,
            ok: bucketNames.has(name),
          })),
          bucketError: storageBuckets.error,
          schema: {
            generationBatchesSettings: schemaChecks[0].ok,
            generationItemsQueueColumns: schemaChecks[1].ok,
            workerRuns: schemaChecks[2].ok,
            audioClips: schemaChecks[3].ok,
            videoLibrary: schemaChecks[4].ok,
            sourceCandidates: schemaChecks[5].ok,
            sourceCandidateUses: schemaChecks[6].ok,
            renderAttempts: schemaChecks[7].ok,
            postScheduleSlots: schemaChecks[8].ok,
            errors: schemaErrors,
            warnings: schemaWarnings,
          },
          account: accountData
            ? {
                id: accountData.id,
                platform: accountData.platform,
                handle: accountData.handle,
                tiktokConnected: !!accountData.tiktok_connected_at,
                tiktokCreatorInfo: accountData.tiktok_creator_info ?? null,
              }
            : null,
          queueCounts,
          blockedPublishCounts,
          dataErrors,
          lastWorkerError,
          cron: {
            configured: envStatus.cronSecret,
            schedule: "*/5 * * * *",
            detectable: false,
          },
          recentWorkerRuns: workerRuns,
          recentFailedItems: failedItems,
        });
      }

      case "create": {
        const res = await callChild(
          "create-generation-batch",
          buildCampaignCreateBatchPayload(body),
        );
        const json = await readJson(res);
        if (!res.ok) {
          return errorEnvelope(childError(json, "create failed"), "CREATE_FAILED", res.status);
        }
        const data = normalizeCampaignCreateResponse(json);
        const audioAssetId = maybeId(data.audio_asset);
        const batchId = maybeId(data.batch);
        if (audioAssetId) {
          callChild("transcribe-audio", { audioAssetId }).catch(() => {});
        }
        // Generate AI video prompts for the batch (best-effort, fire-and-forget).
        if (batchId) {
          callChild("generate-video-prompts", { batchId }).catch(() => {});
        }
        return okEnvelope(data, "Campaign created.");
      }

      case "generatePrompts": {
        const batchId = body.batchId as string | undefined;
        if (!batchId) throw new Error("batchId required");
        const r = await callChild("generate-video-prompts", { batchId });
        const j = await readJson(r);
        if (!r.ok) {
          return errorEnvelope(childError(j, "prompts failed"), "PROMPTS_FAILED", r.status);
        }
        return okEnvelope(unwrapEnvelopeData(j));
      }

      case "runGenerationWorkers": {
        const res = await callWorker("fanpage-generate-due", {});
        const json = await readJson(res);
        if (!res.ok) {
          return errorEnvelope(
            childError(json, "fanpage-generate-due failed"),
            "GENERATION_WORKER_FAILED",
            res.status,
          );
        }
        return okEnvelope(unwrapEnvelopeData(json));
      }

      case "runPublishWorker": {
        const res = await callWorker("fanpage-publish-due", {});
        const json = await readJson(res);
        if (!res.ok) {
          return errorEnvelope(
            childError(json, "fanpage-publish-due failed"),
            "PUBLISH_WORKER_FAILED",
            res.status,
          );
        }
        return okEnvelope(unwrapEnvelopeData(json));
      }

      case "pause": {
        const batchId = body.batchId as string | undefined;
        if (!batchId) throw new Error("batchId required");
        const r = await supabase
          .from("generation_batches")
          .update({ paused_at: new Date().toISOString(), status: "paused" })
          .eq("id", batchId);
        if (r.error) throw r.error;
        return okEnvelope({ ok: true });
      }

      case "resume": {
        const batchId = body.batchId as string | undefined;
        if (!batchId) throw new Error("batchId required");
        const r = await supabase
          .from("generation_batches")
          .update({ paused_at: null, status: "pending" })
          .eq("id", batchId);
        if (r.error) throw r.error;
        return okEnvelope({ ok: true });
      }

      case "cancel": {
        const batchId = body.batchId as string | undefined;
        if (!batchId) throw new Error("batchId required");
        const now = new Date().toISOString();
        const batch = await supabase
          .from("generation_batches")
          .update({
            paused_at: now,
            completed_at: now,
            status: "failed",
            error_message: "campaign canceled by user",
            updated_at: now,
          })
          .eq("id", batchId);
        if (batch.error) throw batch.error;

        const items = await supabase
          .from("generation_items")
          .update({
            status: "skipped",
            error_message: "campaign canceled by user",
            updated_at: now,
          })
          .eq("batch_id", batchId)
          .neq("status", "ready")
          .neq("status", "complete")
          .neq("status", "skipped");
        if (items.error) throw items.error;

        const posts = await supabase
          .from("posts")
          .update({ status: "skipped", publish_status: "canceled", updated_at: now })
          .eq("batch_id", batchId)
          .neq("status", "posted");
        if (posts.error) throw posts.error;
        return okEnvelope({ ok: true });
      }

      case "skip": {
        const itemId = body.itemId as string | undefined;
        if (!itemId) throw new Error("itemId required");
        const skippedItem = await supabase
          .from("generation_items")
          .update({ status: "skipped", error_message: "skipped by user" })
          .eq("id", itemId);
        if (skippedItem.error) throw skippedItem.error;

        const skippedPosts = await supabase
          .from("posts")
          .update({ status: "skipped" })
          .eq("generation_item_id", itemId);
        if (skippedPosts.error) throw skippedPosts.error;
        return okEnvelope({ ok: true });
      }

      case "regenerate": {
        const itemId = body.itemId as string | undefined;
        if (!itemId) throw new Error("itemId required");
        const item = await supabase
          .from("generation_items")
          .select("id,batch_id,post_id,library_item_id,lyric_template_id")
          .eq("id", itemId)
          .maybeSingle();
        if (item.error) throw item.error;
        if (!item.data) throw new Error("Generation item not found.");
        const batch = await supabase
          .from("generation_batches")
          .select("id,lyric_template_id")
          .eq("id", item.data.batch_id)
          .maybeSingle();
        if (batch.error) throw batch.error;
        const lyricTemplateId =
          item.data.lyric_template_id ?? batch.data?.lyric_template_id ?? null;
        if (lyricTemplateId) {
          const template = await supabase
            .from("kanvas_lyric_templates")
            .select("id,status,lyric_blocks,trimmed_audio_asset_id")
            .eq("id", lyricTemplateId)
            .maybeSingle();
          if (template.error) throw template.error;
          const validation = validateTemplateForRender(template.data);
          if (!validation.ok) {
            return errorEnvelope(validation.message, validation.code, 400);
          }
        }
        if (item.data?.post_id) {
          const skippedPost = await supabase
            .from("posts")
            .update({
              status: "skipped",
              publish_status: "regenerated",
              generation_item_id: null,
            })
            .eq("id", item.data.post_id)
            .neq("status", "posted");
          if (skippedPost.error) throw skippedPost.error;
        }
        const skippedGenerationPosts = await supabase
          .from("posts")
          .update({
            status: "skipped",
            publish_status: "regenerated",
            generation_item_id: null,
          })
          .eq("generation_item_id", itemId)
          .neq("status", "posted");
        if (skippedGenerationPosts.error) throw skippedGenerationPosts.error;
        if (item.data?.library_item_id) {
          const skippedLibraryPosts = await supabase
            .from("posts")
            .update({
              status: "skipped",
              publish_status: "regenerated",
              generation_item_id: null,
            })
            .eq("library_item_id", item.data.library_item_id)
            .neq("status", "posted");
          if (skippedLibraryPosts.error) throw skippedLibraryPosts.error;
        }
        const clearedUses = await supabase
          .from("source_candidate_uses")
          .delete()
          .eq("generation_item_id", itemId);
        if (clearedUses.error) throw clearedUses.error;
        if (item.data?.library_item_id) {
          const resetLibrary = await supabase
            .from("video_library_items")
            .update({
              status: "not_ready",
              final_asset_id: null,
              thumbnail_url: null,
              segments: [],
              provenance: [],
              perceptual_hash: null,
              reused_flags: {},
              default_caption: null,
              default_hashtags: [],
              metadata: {},
              updated_at: new Date().toISOString(),
            })
            .eq("id", item.data.library_item_id);
          if (resetLibrary.error) throw resetLibrary.error;
        }
        const r = await supabase
          .from("generation_items")
          .update({
            ...createRegenerationReset(),
            lyric_template_id: lyricTemplateId,
            attempt_count: 0,
          })
          .eq("id", itemId);
        if (r.error) throw r.error;
        const attempt = await supabase.from("render_attempts").insert({
          generation_item_id: itemId,
          stage: "karaoke",
          status: "started",
          provider: "user_regenerate",
          detail: {
            cause: "user_regenerate",
            lyric_template_id: lyricTemplateId,
          },
        });
        if (attempt.error) throw attempt.error;
        return okEnvelope({ ok: true });
      }

      case "markLibraryItemUnfit": {
        const libraryItemId = body.libraryItemId as string | undefined;
        if (!libraryItemId) throw new Error("libraryItemId required");
        const libraryItem = await supabase
          .from("video_library_items")
          .select("id,generation_item_id,metadata")
          .eq("id", libraryItemId)
          .maybeSingle();
        if (libraryItem.error) throw libraryItem.error;
        if (!libraryItem.data) throw new Error("Library item not found.");

        const now = new Date();
        const blockedLibrary = await supabase
          .from("video_library_items")
          .update(
            buildLibraryUnfitUpdate({
              metadata: libraryItem.data.metadata,
              reason: body.reason,
              now,
            }),
          )
          .eq("id", libraryItemId);
        if (blockedLibrary.error) throw blockedLibrary.error;

        if (libraryItem.data.generation_item_id) {
          const skippedItem = await supabase
            .from("generation_items")
            .update({
              status: "skipped",
              error_message: "library item marked unfit by user",
              updated_at: now.toISOString(),
            })
            .eq("id", libraryItem.data.generation_item_id);
          if (skippedItem.error) throw skippedItem.error;
        }

        const skippedPosts = await supabase
          .from("posts")
          .update({
            status: "skipped",
            publish_status: null,
          })
          .eq("library_item_id", libraryItemId)
          .neq("status", "posted");
        if (skippedPosts.error) throw skippedPosts.error;

        return okEnvelope({ ok: true, libraryItemId });
      }

      case "recoverRecentFailures": {
        const since = String(body.since ?? "2026-05-12T00:00:00.000Z");
        const limit = Math.max(1, Math.min(Number(body.limit ?? 250), 250));
        const includeFailed = body.includeFailed !== false;
        const includeStaleActive = body.includeStaleActive !== false;
        if (!includeFailed && !includeStaleActive) {
          return okEnvelope({ ok: true, recovered: 0, recoveredIds: [] });
        }

        const recovered = await supabase.rpc("recover_generation_items", {
          p_since: since,
          p_limit: limit,
          p_include_failed: includeFailed,
          p_include_stale_active: includeStaleActive,
        });
        if (recovered.error) throw recovered.error;

        const rows = (recovered.data ?? []) as Array<{
          id: string;
          recovered_from: string;
          library_item_id: string | null;
        }>;
        return okEnvelope({
          ok: true,
          recovered: rows.length,
          recoveredIds: rows.map((row) => row.id),
          recoveredRows: rows,
        });
      }

      case "setLyricTemplate": {
        const lyricTemplateId = (body.lyricTemplateId as string | null) ?? null;
        const itemId = body.itemId as string | undefined;
        const batchId = body.batchId as string | undefined;
        if (itemId) {
          const r = await supabase
            .from("generation_items")
            .update({ lyric_template_id: lyricTemplateId })
            .eq("id", itemId);
          if (r.error) throw r.error;
        } else if (batchId) {
          const rb = await supabase
            .from("generation_batches")
            .update({ lyric_template_id: lyricTemplateId })
            .eq("id", batchId);
          if (rb.error) throw rb.error;
          const ri = await supabase
            .from("generation_items")
            .update({ lyric_template_id: lyricTemplateId })
            .eq("batch_id", batchId);
          if (ri.error) throw ri.error;
        } else {
          throw new Error("itemId or batchId required");
        }
        return okEnvelope({ ok: true });
      }

      default:
        return errorEnvelope(`Unknown action: ${action}`, "UNKNOWN_ACTION", 400);
    }
  } catch (error) {
    return errorEnvelope(error, "INTERNAL_ERROR", 500);
  }
});
