// Worker-run + cron-secret helpers shared by fanpage-* workers.

import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { optionalEnv, requireEnv } from "./env.ts";
import { getSupabaseAdmin } from "./supabase.ts";

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
