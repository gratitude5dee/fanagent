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

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { errorMessage, serializeError } from "../_shared/errors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

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
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

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
        return jsonResponse({
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
        };

        const buckets = await supabase.storage.listBuckets();
        const expectedBuckets = ["post-assets", "stock-cache", "audio-uploads", "renders"];
        const bucketNames = new Set((buckets.data ?? []).map((bucket) => bucket.name));
        const schemaChecks = await Promise.all([
          supabase.from("generation_batches").select("settings,publish_defaults").limit(1),
          supabase.from("generation_items").select("attempt_count,locked_at,stage_events").limit(1),
          supabase.from("worker_runs").select("id").limit(1),
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
        const accountRow = await supabase
          .from("accounts")
          .select("id,platform,handle,tiktok_connected_at,tiktok_creator_info,is_primary")
          .eq("platform", "tiktok")
          .eq("is_primary", true)
          .maybeSingle();
        const workerRuns = recentWorkerRuns.data ?? [];
        const lastWorkerError =
          workerRuns.find((run) => Number(run.errors_count ?? 0) > 0)?.detail ?? null;

        return jsonResponse({
          env: envStatus,
          buckets: expectedBuckets.map((name) => ({
            name,
            ok: bucketNames.has(name),
          })),
          schema: {
            generationBatchesSettings: !schemaChecks[0].error,
            generationItemsQueueColumns: !schemaChecks[1].error,
            workerRuns: !schemaChecks[2].error,
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
        const res = await callChild("create-generation-batch", {
          ...body,
          sourceMode: (body.sourceMode as string) ?? "stock",
          cadenceMinutes: (body.cadenceMinutes as number) ?? 1440,
          count: (body.postCount as number) ?? 14,
          durationSeconds: (body.durationSeconds as number) ?? 15,
        });
        const json = await res.json();
        if (!res.ok) return errorResponse(json.errorDetail ?? json.error ?? "create failed", 500);
        const audioAssetId = json?.audioAsset?.id;
        const batchId = json?.batch?.id;
        if (audioAssetId) {
          callChild("transcribe-audio", { audioAssetId }).catch(() => {});
        }
        // Generate AI video prompts for the batch (best-effort, fire-and-forget).
        if (batchId) {
          callChild("generate-video-prompts", { batchId }).catch(() => {});
        }
        return jsonResponse(json);
      }

      case "generatePrompts": {
        const batchId = body.batchId as string | undefined;
        if (!batchId) throw new Error("batchId required");
        const r = await callChild("generate-video-prompts", { batchId });
        const j = await r.json();
        if (!r.ok) return errorResponse(j.errorDetail ?? j.error ?? "prompts failed", 500);
        return jsonResponse(j);
      }

      case "runGenerationWorkers": {
        const res = await callWorker("fanpage-generate-due", {});
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          return errorResponse(
            json.errorDetail ?? json.error ?? "fanpage-generate-due failed",
            500,
          );
        }
        return jsonResponse(json);
      }

      case "runPublishWorker": {
        const res = await callWorker("fanpage-publish-due", {});
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          return errorResponse(json.errorDetail ?? json.error ?? "fanpage-publish-due failed", 500);
        }
        return jsonResponse(json);
      }

      case "pause": {
        const batchId = body.batchId as string | undefined;
        if (!batchId) throw new Error("batchId required");
        const r = await supabase
          .from("generation_batches")
          .update({ paused_at: new Date().toISOString(), status: "paused" })
          .eq("id", batchId);
        if (r.error) throw r.error;
        return jsonResponse({ ok: true });
      }

      case "resume": {
        const batchId = body.batchId as string | undefined;
        if (!batchId) throw new Error("batchId required");
        const r = await supabase
          .from("generation_batches")
          .update({ paused_at: null, status: "pending" })
          .eq("id", batchId);
        if (r.error) throw r.error;
        return jsonResponse({ ok: true });
      }

      case "skip": {
        const itemId = body.itemId as string | undefined;
        if (!itemId) throw new Error("itemId required");
        await supabase
          .from("generation_items")
          .update({ status: "failed", error_message: "skipped by user" })
          .eq("id", itemId);
        await supabase.from("posts").update({ status: "skipped" }).eq("generation_item_id", itemId);
        return jsonResponse({ ok: true });
      }

      case "regenerate": {
        const itemId = body.itemId as string | undefined;
        if (!itemId) throw new Error("itemId required");
        const r = await supabase
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
          })
          .eq("id", itemId);
        if (r.error) throw r.error;
        return jsonResponse({ ok: true });
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

        return jsonResponse({ ok: true, recovered: recoveredIds.length, recoveredIds });
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
        return jsonResponse({ ok: true });
      }

      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (error) {
    return errorResponse({
      ...serializeError(error),
      message: errorMessage(error),
    });
  }
});
