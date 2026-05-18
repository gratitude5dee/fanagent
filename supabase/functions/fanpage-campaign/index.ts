// User-facing campaign API for the autopilot wizard. Single function,
// dispatched by `action`, to keep the frontend wiring simple.
//
// Actions:
//   list                                → all batches + items for the primary account
//   create   { audioBase64, sourceMode, postCount, cadenceMinutes, prompt }
//                                       → wraps create-generation-batch
//   pause    { batchId }                → marks batch paused_at = now()
//   resume   { batchId }                → clears paused_at
//   skip     { itemId }                 → marks item skipped
//   regenerate { itemId }              → resets item to pending so the worker reruns it
//   recoverRecentFailures { since, limit } → bulk-reset recent failed unposted items

import { handleOptions } from "../_shared/cors.ts";
import {
  buildCampaignCreateBatchPayload,
  normalizeCampaignCreateResponse,
} from "../_shared/campaign.ts";
import { okEnvelope, errorEnvelope, unwrapEnvelopeData } from "../_shared/envelope.ts";
import { optionalEnv } from "../_shared/env.ts";
import { createRegenerationReset } from "../_shared/generation.ts";
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

async function callChild(name: string, body: unknown): Promise<Response> {
  const url = `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
        const account = await supabase
          .from("accounts")
          .select("*")
          .eq("platform", "tiktok")
          .eq("is_primary", true)
          .maybeSingle();
        const batches = await supabase
          .from("generation_batches")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(25);
        const items = await supabase
          .from("generation_items")
          .select("*")
          .order("scheduled_at", { ascending: true })
          .limit(200);
        const posts = await supabase
          .from("posts")
          .select("*")
          .order("scheduled_at", { ascending: true })
          .limit(200);
        const lyricTemplates = await supabase
          .from("kanvas_lyric_templates")
          .select("id,title,status,total_duration_ms,selection_duration_ms,updated_at")
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(100);
        return okEnvelope({
          account: account.data ?? null,
          batches: batches.data ?? [],
          items: items.data ?? [],
          posts: posts.data ?? [],
          lyricTemplates: lyricTemplates.data ?? [],
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

        const buckets = await supabase.storage.listBuckets();
        const expectedBuckets = [
          "post-assets",
          "stock-cache",
          "audio-uploads",
          "renders",
          "thumbnails",
        ];
        const bucketNames = new Set((buckets.data ?? []).map((bucket) => bucket.name));
        const schemaChecks = await Promise.all([
          supabase.from("generation_batches").select("settings,publish_defaults").limit(1),
          supabase.from("generation_items").select("attempt_count,locked_at,stage_events").limit(1),
          supabase.from("worker_runs").select("id").limit(1),
          supabase.from("video_library_items").select("id,status,final_asset_id").limit(1),
          supabase.from("source_candidates").select("id,source_type,provider").limit(1),
          supabase.from("render_attempts").select("id,stage,status").limit(1),
        ]);
        const recentWorkerRuns = await supabase
          .from("worker_runs")
          .select("function_name,started_at,ended_at,items_processed,errors_count,detail")
          .order("started_at", { ascending: false })
          .limit(10);
        const recentFailedItems = await supabase
          .from("generation_items")
          .select("id,status,provider,error_message,updated_at")
          .eq("status", "failed")
          .order("updated_at", { ascending: false })
          .limit(50);
        const queueRows = await supabase.from("generation_items").select("status").limit(5000);
        const queueCounts = (queueRows.data ?? []).reduce<Record<string, number>>((acc, row) => {
          const status = String((row as { status?: string }).status ?? "unknown");
          acc[status] = (acc[status] ?? 0) + 1;
          return acc;
        }, {});
        const blockedPublishRows = await supabase
          .from("posts")
          .select("publish_status")
          .like("publish_status", "blocked_%")
          .limit(5000);
        const blockedPublishCounts = (blockedPublishRows.data ?? []).reduce<Record<string, number>>(
          (acc, row) => {
            const status = String((row as { publish_status?: string }).publish_status ?? "");
            if (status) acc[status] = (acc[status] ?? 0) + 1;
            return acc;
          },
          {},
        );
        const accountRow = await supabase
          .from("accounts")
          .select("id,platform,handle,tiktok_connected_at,tiktok_creator_info,is_primary")
          .eq("platform", "tiktok")
          .eq("is_primary", true)
          .maybeSingle();
        const workerRuns = recentWorkerRuns.data ?? [];
        const lastWorkerError =
          workerRuns.find((run) => Number(run.errors_count ?? 0) > 0)?.detail ?? null;

        return okEnvelope({
          env: envStatus,
          buckets: expectedBuckets.map((name) => ({
            name,
            ok: bucketNames.has(name),
          })),
          schema: {
            generationBatchesSettings: !schemaChecks[0].error,
            generationItemsQueueColumns: !schemaChecks[1].error,
            workerRuns: !schemaChecks[2].error,
            videoLibrary: !schemaChecks[3].error,
            sourceCandidates: !schemaChecks[4].error,
            renderAttempts: !schemaChecks[5].error,
            errors: schemaChecks.map((check) => check.error?.message).filter(Boolean),
          },
          account: accountRow.data
            ? {
                id: accountRow.data.id,
                platform: accountRow.data.platform,
                handle: accountRow.data.handle,
                tiktokConnected: !!accountRow.data.tiktok_connected_at,
                tiktokCreatorInfo: accountRow.data.tiktok_creator_info ?? null,
              }
            : null,
          queueCounts,
          blockedPublishCounts,
          lastWorkerError,
          cron: {
            configured: envStatus.cronSecret,
            schedule: "*/5 * * * *",
            detectable: false,
          },
          recentWorkerRuns: workerRuns,
          recentFailedItems: recentFailedItems.data ?? [],
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

      case "skip": {
        const itemId = body.itemId as string | undefined;
        if (!itemId) throw new Error("itemId required");
        await supabase
          .from("generation_items")
          .update({ status: "failed", error_message: "skipped by user" })
          .eq("id", itemId);
        await supabase.from("posts").update({ status: "skipped" }).eq("generation_item_id", itemId);
        return okEnvelope({ ok: true });
      }

      case "regenerate": {
        const itemId = body.itemId as string | undefined;
        if (!itemId) throw new Error("itemId required");
        const item = await supabase
          .from("generation_items")
          .select("post_id,library_item_id")
          .eq("id", itemId)
          .maybeSingle();
        if (item.error) throw item.error;
        if (item.data?.post_id) {
          await supabase
            .from("posts")
            .update({
              status: "skipped",
              publish_status: null,
              generation_item_id: null,
            })
            .eq("id", item.data.post_id)
            .neq("status", "posted");
        }
        await supabase.from("source_candidate_uses").delete().eq("generation_item_id", itemId);
        if (item.data?.library_item_id) {
          await supabase
            .from("video_library_items")
            .update({
              status: "not_ready",
              final_asset_id: null,
              thumbnail_url: null,
              duration_sec: null,
              segments: null,
              provenance: null,
              perceptual_hash: null,
              error_message: null,
            })
            .eq("id", item.data.library_item_id);
        }
        const r = await supabase
          .from("generation_items")
          .update({ ...createRegenerationReset(), attempt_count: 0 })
          .eq("id", itemId);
        if (r.error) throw r.error;
        return okEnvelope({ ok: true });
      }

      case "recoverRecentFailures": {
        const since = String(body.since ?? "2026-05-12T00:00:00.000Z");
        const limit = Math.max(1, Math.min(Number(body.limit ?? 250), 250));
        const failed = await supabase
          .from("generation_items")
          .select("id,stage_events")
          .eq("status", "failed")
          .is("post_id", null)
          .gte("updated_at", since)
          .order("updated_at", { ascending: false })
          .limit(limit);
        if (failed.error) throw failed.error;

        const recoveredIds: string[] = [];
        for (const row of failed.data ?? []) {
          const events = Array.isArray(row.stage_events) ? row.stage_events : [];
          const update = await supabase
            .from("generation_items")
            .update({
              status: "pending",
              segments: null,
              stock_clip_url: null,
              render_job_id: null,
              final_asset_id: null,
              provider_request_id: null,
              error_message: null,
              attempt_count: 0,
              locked_at: null,
              locked_by: null,
              last_attempt_at: null,
              stage_events: [
                ...events.slice(-40),
                { stage: "recovered", at: new Date().toISOString(), reason: "live repair" },
              ],
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          if (update.error) throw update.error;
          recoveredIds.push(row.id as string);
        }

        return okEnvelope({ ok: true, recovered: recoveredIds.length, recoveredIds });
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
