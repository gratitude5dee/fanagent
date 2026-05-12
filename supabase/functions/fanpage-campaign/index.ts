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

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

async function callChild(name: string, body: unknown): Promise<Response> {
  const url = `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
  const serviceKey = optionalEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function callWorker(name: string, body: unknown): Promise<Response> {
  const url = `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
  const serviceKey = optionalEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = optionalEnv("CRON_SECRET") ?? "";
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
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
    const body = await request.json() as { action?: string } & Record<string, unknown>;
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

      case "create": {
        const res = await callChild("create-generation-batch", {
          ...body,
          sourceMode: (body.sourceMode as string) ?? "stock",
          cadenceMinutes: (body.cadenceMinutes as number) ?? 1440,
          count: (body.postCount as number) ?? 14,
          durationSeconds: (body.durationSeconds as number) ?? 15,
        });
        const json = await res.json();
        if (!res.ok) return errorResponse(json.error ?? "create failed", 500);
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
        if (!r.ok) return errorResponse(j.error ?? "prompts failed", 500);
        return jsonResponse(j);
      }

      case "runGenerationWorkers": {
        const [processRes, stockRes] = await Promise.all([
          callChild("process-generation-due", {}),
          callWorker("fanpage-generate-due", {}),
        ]);
        const processJson = await processRes.json().catch(() => ({}));
        const stockJson = await stockRes.json().catch(() => ({}));
        if (!processRes.ok) return errorResponse(processJson.error ?? "process-generation-due failed", 500);
        if (!stockRes.ok) return errorResponse(stockJson.error ?? "fanpage-generate-due failed", 500);
        return jsonResponse({ process: processJson, stock: stockJson });
      }

      case "runPublishWorker": {
        const res = await callWorker("fanpage-publish-due", {});
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return errorResponse(json.error ?? "fanpage-publish-due failed", 500);
        return jsonResponse(json);
      }

      case "pause": {
        const batchId = body.batchId as string | undefined;
        if (!batchId) throw new Error("batchId required");
        const r = await supabase.from("generation_batches")
          .update({ paused_at: new Date().toISOString(), status: "paused" })
          .eq("id", batchId);
        if (r.error) throw r.error;
        return jsonResponse({ ok: true });
      }

      case "resume": {
        const batchId = body.batchId as string | undefined;
        if (!batchId) throw new Error("batchId required");
        const r = await supabase.from("generation_batches")
          .update({ paused_at: null, status: "pending" })
          .eq("id", batchId);
        if (r.error) throw r.error;
        return jsonResponse({ ok: true });
      }

      case "skip": {
        const itemId = body.itemId as string | undefined;
        if (!itemId) throw new Error("itemId required");
        await supabase.from("generation_items")
          .update({ status: "failed", error_message: "skipped by user" })
          .eq("id", itemId);
        await supabase.from("posts")
          .update({ status: "skipped" })
          .eq("generation_item_id", itemId);
        return jsonResponse({ ok: true });
      }

      case "regenerate": {
        const itemId = body.itemId as string | undefined;
        if (!itemId) throw new Error("itemId required");
        const r = await supabase.from("generation_items")
          .update({
            status: "pending",
            stock_clip_url: null,
            render_job_id: null,
            error_message: null,
          })
          .eq("id", itemId);
        if (r.error) throw r.error;
        return jsonResponse({ ok: true });
      }

      case "setLyricTemplate": {
        const lyricTemplateId = (body.lyricTemplateId as string | null) ?? null;
        const itemId = body.itemId as string | undefined;
        const batchId = body.batchId as string | undefined;
        if (itemId) {
          const r = await supabase.from("generation_items")
            .update({ lyric_template_id: lyricTemplateId })
            .eq("id", itemId);
          if (r.error) throw r.error;
        } else if (batchId) {
          const rb = await supabase.from("generation_batches")
            .update({ lyric_template_id: lyricTemplateId })
            .eq("id", batchId);
          if (rb.error) throw rb.error;
          const ri = await supabase.from("generation_items")
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
    return errorResponse(error);
  }
});
