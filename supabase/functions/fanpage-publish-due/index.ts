// Cron-secured wrapper around publish-tiktok-due that also records a
// worker_runs row + per-attempt entries in publish_attempts. Forwards the
// actual TikTok mechanics to the existing publish-tiktok-due function.

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import {
  endWorkerRun,
  isAuthorizedCronCall,
  startWorkerRun,
} from "../_shared/workers.ts";

const FUNCTION_NAME = "fanpage-publish-due";

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;

  if (!await isAuthorizedCronCall(request)) {
    return errorResponse("Unauthorized cron call", 401);
  }

  const runId = await startWorkerRun(FUNCTION_NAME);

  try {
    const url = `${optionalEnv("SUPABASE_URL")}/functions/v1/publish-tiktok-due`;
    const serviceKey = optionalEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const body = await res.json() as {
      processed?: number;
      results?: Array<Record<string, unknown>>;
      error?: string;
    };
    if (!res.ok) throw new Error(body.error ?? `publish-tiktok-due ${res.status}`);

    // Persist a publish_attempt row per result so the dashboard can
    // surface attempt history without re-parsing agent_logs.
    const supabase = getSupabaseAdmin();
    const attempts = (body.results ?? []).map((r) => ({
      post_id: (r.id as string) ?? null,
      tiktok_publish_id: (r.publishId as string | undefined) ?? null,
      status: (r.status as string | undefined) ?? "unknown",
      error: (r.error as string | undefined) ?? null,
      raw_response: r,
    })).filter((a) => a.post_id);
    if (attempts.length) {
      await supabase.from("publish_attempts").insert(attempts);
    }

    const errors = (body.results ?? []).filter(
      (r) => r.status === "failed" || r.status === "FAILED",
    ).length;
    await endWorkerRun(runId, body.processed ?? 0, errors, { results: body.results });

    return jsonResponse({ processed: body.processed ?? 0, results: body.results });
  } catch (error) {
    await endWorkerRun(runId, 0, 1, {
      fatal: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error);
  }
});
