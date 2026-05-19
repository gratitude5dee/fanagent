import { getSupabaseAdmin } from "./supabase.ts";

export type RenderAttemptStage = "sourcing" | "stitch" | "karaoke" | "thumbnail" | "finalize";

type RenderAttemptInput = {
  generationItemId: string;
  stage: RenderAttemptStage;
  provider?: string | null;
  requestId?: string | null;
  detail?: Record<string, unknown>;
};

function resultDetail(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of [
    "itemId",
    "segmentIndex",
    "url",
    "stitchMode",
    "provider",
    "finalAssetId",
    "thumbnailUrl",
  ]) {
    if (key in record) picked[key] = record[key];
  }
  return Object.keys(picked).length > 0 ? picked : value;
}

export async function withRenderAttempt<T>(
  input: RenderAttemptInput,
  run: () => Promise<T>,
): Promise<T> {
  const supabase = getSupabaseAdmin();
  const started = await supabase
    .from("render_attempts")
    .insert({
      generation_item_id: input.generationItemId,
      stage: input.stage,
      status: "started",
      provider: input.provider ?? null,
      request_id: input.requestId ?? null,
      detail: input.detail ?? {},
    })
    .select("id")
    .single();
  if (started.error) throw started.error;

  try {
    const result = await run();
    const update = await supabase
      .from("render_attempts")
      .update({
        status: "succeeded",
        ended_at: new Date().toISOString(),
        detail: {
          ...(input.detail ?? {}),
          result: resultDetail(result),
        },
      })
      .eq("id", started.data.id);
    if (update.error) throw update.error;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("render_attempts")
      .update({
        status: "failed",
        ended_at: new Date().toISOString(),
        error: message,
        detail: input.detail ?? {},
      })
      .eq("id", started.data.id);
    throw error;
  }
}
