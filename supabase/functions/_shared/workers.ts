// Worker-run + cron-secret helpers shared by fanpage-* workers.

import { requireEnv } from "./env.ts";
import { getSupabaseAdmin } from "./supabase.ts";

export function isAuthorizedCronCall(request: Request): boolean {
  const expected = requireEnv("CRON_SECRET");
  return request.headers.get("x-cron-secret") === expected;
}

export async function startWorkerRun(functionName: string): Promise<string> {
  const supabase = getSupabaseAdmin();
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
