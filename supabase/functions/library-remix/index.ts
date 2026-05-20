// library-remix: instant-render entrypoint.
//
// Takes a lyric template + category constraints and immediately builds a
// library batch with auto_render=true. The existing fanpage-generate-due
// worker claims the items, runs the pool resolver / pick-stock-clip /
// stitch / render pipeline, and library-finalize promotes each
// video_library_items row to status='ready'. No posts row is created here.

import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type RemixRequest = {
  accountId?: string;
  lyricTemplateId?: string;
  categoryId?: string | null;
  subcategorySlug?: string | null;
  randomize?: boolean;
  count?: number;
  prompt?: string;
  durationSeconds?: number;
  stockSettings?: Record<string, unknown>;
  seedanceSettings?: Record<string, unknown>;
  publishDefaults?: Record<string, unknown>;
};

function fnUrl(name: string): string {
  return `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") {
    return errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405);
  }

  try {
    const body = (await request.json()) as RemixRequest;
    if (!body.accountId) throw new Error("accountId is required.");
    if (!body.lyricTemplateId) throw new Error("lyricTemplateId is required.");

    const count = Math.max(1, Math.min(Math.floor(Number(body.count ?? 1)), 50));

    const supabase = getSupabaseAdmin();

    // Resolve the lyric template -> audio clip + category metadata so the
    // pool resolver can enforce category isolation.
    const tpl = await supabase
      .from("kanvas_lyric_templates")
      .select("id,status,archived_at,audio_clip_id,selection_duration_ms")
      .eq("id", body.lyricTemplateId)
      .maybeSingle();
    if (tpl.error) throw tpl.error;
    if (!tpl.data) throw new Error("Lyric template not found.");
    if (tpl.data.archived_at || tpl.data.status === "archived") {
      throw new Error("Lyric template is archived.");
    }
    if (tpl.data.status !== "saved") {
      throw new Error("Lyric template must be saved before remixing.");
    }
    if (!tpl.data.audio_clip_id) {
      throw new Error("Lyric template is not linked to an audio clip.");
    }

    // Resolve the category -> source_type so the worker routes through the
    // correct adapter when no provider override is supplied.
    let sourceMode = "stock";
    if (body.categoryId) {
      const cat = await supabase
        .from("clip_categories")
        .select("id,source_type")
        .eq("id", body.categoryId)
        .maybeSingle();
      if (cat.error) throw cat.error;
      if (!cat.data) throw new Error("Clip category not found.");
      sourceMode = String(cat.data.source_type ?? "stock");
    }

    const durationSeconds = Math.floor(
      Number(body.durationSeconds ?? (tpl.data.selection_duration_ms ?? 15_000) / 1000),
    );

    const payload = {
      accountId: body.accountId,
      audioClipId: tpl.data.audio_clip_id,
      lyricTemplateId: tpl.data.id,
      sourceMode,
      categoryId: body.categoryId ?? null,
      subcategorySlug: body.subcategorySlug ?? null,
      randomize: body.randomize === true,
      autoRender: true,
      quantity: count,
      durationSeconds,
      prompt: body.prompt ?? "music-driven fan edit with cinematic visuals",
      stockSettings: body.stockSettings ?? {},
      seedanceSettings: body.seedanceSettings ?? {},
      publishDefaults: body.publishDefaults ?? {},
    };

    const childResponse = await fetch(fnUrl("create-generation-batch"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": optionalEnv("CRON_SECRET") ?? "",
      },
      body: JSON.stringify(payload),
    });
    const text = await childResponse.text();
    const json = text ? JSON.parse(text) : {};
    if (!childResponse.ok) {
      return errorEnvelope(
        json?.error ?? "create-generation-batch failed",
        "LIBRARY_REMIX_CREATE_FAILED",
        childResponse.status,
      );
    }

    // Kick off the generation worker immediately so the user does not wait
    // for the next cron tick.
    fetch(fnUrl("fanpage-generate-due"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": optionalEnv("CRON_SECRET") ?? "",
      },
      body: JSON.stringify({}),
    }).catch(() => {});

    return okEnvelope(json?.data ?? json, "Remix queued for instant render.");
  } catch (error) {
    return errorEnvelope(error, "LIBRARY_REMIX_FAILED", 500);
  }
});
