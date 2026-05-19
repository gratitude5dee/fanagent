// Worker-run + cron-secret helpers shared by fanpage-* workers.

import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { optionalEnv, requireEnv } from "./env.ts";
import { getSupabaseAdmin } from "./supabase.ts";

type WorkerRunRow = {
  id: string;
  detail: Record<string, unknown> | null;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function isAuthorizedCronCall(request: Request): Promise<boolean> {
  const expected = optionalEnv("CRON_SECRET");
  if (expected && request.headers.get("x-cron-secret") === expected) {
    return true;
  }

  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  try {
    const supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_ANON_KEY"),
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );
    const { data, error } = await supabase.auth.getClaims(token);
    return !error && !!data?.claims;
  } catch {
    return false;
  }
}

export async function recoverStaleWorkerRuns(
  functionName: string,
  staleMinutes = 10,
): Promise<number> {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - Math.max(1, staleMinutes) * 60_000).toISOString();
  const staleRuns = await supabase
    .from("worker_runs")
    .select("id,detail")
    .eq("function_name", functionName)
    .is("ended_at", null)
    .lt("started_at", staleBefore)
    .limit(25);
  if (staleRuns.error) throw staleRuns.error;

  const rows = (staleRuns.data ?? []) as WorkerRunRow[];
  const updates = await Promise.all(
    rows.map((row) =>
      supabase
        .from("worker_runs")
        .update({
          ended_at: now.toISOString(),
          detail: {
            ...record(row.detail),
            recovered_stale_open_run: true,
            recovered_at: now.toISOString(),
            recovered_by: functionName,
          },
        })
        .eq("id", row.id)
        .is("ended_at", null),
    ),
  );
  const failed = updates.find((update) => update.error);
  if (failed?.error) throw failed.error;

  return rows.length;
}

export async function startWorkerRun(functionName: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  await recoverStaleWorkerRuns(functionName);
  const inserted = await supabase
    .from("worker_runs")
    .insert({ function_name: functionName })
    .select("id")
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id as string;
}

export async function endWorkerRun(
  runId: string,
  itemsProcessed: number,
  errorsCount: number,
  detail?: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("worker_runs")
    .update({
      ended_at: new Date().toISOString(),
      items_processed: itemsProcessed,
      errors_count: errorsCount,
      detail: detail ?? null,
    })
    .eq("id", runId);
}
