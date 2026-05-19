// Cron-secured wrapper around publish-tiktok-due that also records a
// worker_runs row + per-attempt entries in publish_attempts. Forwards the
// actual TikTok mechanics to the existing publish-tiktok-due function.

import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope, unwrapEnvelopeData } from "../_shared/envelope.ts";
import { errorMessage, serializeError } from "../_shared/errors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { endWorkerRun, isAuthorizedCronCall, startWorkerRun } from "../_shared/workers.ts";

const FUNCTION_NAME = "fanpage-publish-due";

type PublishWorkerBody = {
  processed?: number;
  results?: Array<Record<string, unknown>>;
};

function clip(value: string, maxLength = 1200): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function publishChildTimeoutMs(): number {
  const configured = Number(optionalEnv("FANAGENT_PUBLISH_CHILD_TIMEOUT_MS") ?? 45_000);
  if (!Number.isFinite(configured)) return 45_000;
  return Math.max(10_000, Math.min(Math.floor(configured), 90_000));
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: clip(text) };
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function childError(json: unknown, fallback: string): unknown {
  const data = record(json);
  return data.errorDetail ?? data.error ?? data.message ?? fallback;
}

async function callPublishWorker(timeoutMs = publishChildTimeoutMs()): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${optionalEnv("SUPABASE_URL")}/functions/v1/publish-tiktok-due`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": optionalEnv("CRON_SECRET") ?? "",
      },
      body: JSON.stringify({ rescanBlockedMinutes: 30 }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`publish-tiktok-due timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;

  if (!(await isAuthorizedCronCall(request))) {
    return errorEnvelope("Unauthorized cron call", "UNAUTHORIZED_CRON", 401);
  }

  const runId = await startWorkerRun(FUNCTION_NAME);

  try {
    const res = await callPublishWorker();
    const json = await readJson(res);
    if (!res.ok) throw childError(json, `publish-tiktok-due ${res.status}`);
    const body = unwrapEnvelopeData<PublishWorkerBody>(json);
    const results = body.results ?? [];

    // Persist a publish_attempt row per result so the dashboard can
    // surface attempt history without re-parsing agent_logs.
    const supabase = getSupabaseAdmin();
    const attempts = results
      .map((r) => ({
        post_id: (r.id as string) ?? null,
        tiktok_publish_id: (r.publishId as string | undefined) ?? null,
        status: (r.status as string | undefined) ?? "unknown",
        error: (r.error as string | undefined) ?? null,
        raw_response: r,
      }))
      .filter((a) => a.post_id);
    if (attempts.length) {
      await supabase.from("publish_attempts").insert(attempts);
    }

    const errors = results.filter(
      (r) => r.status === "failed" || r.status === "FAILED",
    ).length;
    await endWorkerRun(runId, body.processed ?? 0, errors, { results });

    return okEnvelope({ processed: body.processed ?? 0, results });
  } catch (error) {
    const message = clip(errorMessage(error));
    await endWorkerRun(runId, 0, 1, {
      fatal: message,
      fatalDetail: serializeError(error),
    });
    return errorEnvelope(message, "PUBLISH_WORKER_FAILED", 500);
  }
});
