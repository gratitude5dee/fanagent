// Transcribe a template's trimmed audio using GMI Cloud Gemini, then store
// word-timed lyric blocks. Falls back gracefully on errors so the UI can offer
// manual entry.
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type Word = { id: string; text: string; startTime: number; endTime: number; confidence?: number };
type Block = { id: string; label: string; startTime: number; endTime: number; words: Word[] };

function uid() { return crypto.randomUUID(); }

async function callGmiCloud(audioUrl: string, apiKey: string): Promise<{ words: Word[]; meta: Record<string, unknown> } | null> {
  // GMI Cloud exposes an OpenAI-compatible Gemini endpoint. We ask the model
  // to return a strict JSON list of word-level timings.
  const res = await fetch("https://api.gmi-serving.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You transcribe sung lyrics with precise word-level timings in seconds. Respond ONLY with strict JSON of shape {\"words\":[{\"text\":\"...\",\"start\":0.0,\"end\":0.4,\"confidence\":0.9}]}." },
        { role: "user", content: [
          { type: "text", text: "Transcribe the lyrics in this audio with word-level timings (seconds)." },
          { type: "input_audio", audio_url: audioUrl },
        ] },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return null;
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = json.choices?.[0]?.message?.content;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { words?: Array<{ text: string; start: number; end: number; confidence?: number }> };
    const words: Word[] = (parsed.words ?? []).map((w) => ({
      id: uid(),
      text: w.text,
      startTime: Number(w.start) || 0,
      endTime: Number(w.end) || Number(w.start) || 0,
      confidence: typeof w.confidence === "number" ? w.confidence : undefined,
    }));
    return { words, meta: { provider: "gmi_cloud", model: "google/gemini-2.5-flash", count: words.length } };
  } catch {
    return null;
  }
}

function wordsToBlocks(words: Word[]): Block[] {
  if (words.length === 0) return [];
  const blocks: Block[] = [];
  let current: Word[] = [];
  let lastEnd = 0;
  for (const w of words) {
    if (current.length && w.startTime - lastEnd > 1.2) {
      blocks.push({
        id: uid(),
        label: `Block ${blocks.length + 1}`,
        startTime: current[0].startTime,
        endTime: current[current.length - 1].endTime,
        words: current,
      });
      current = [];
    }
    current.push(w);
    lastEnd = w.endTime;
  }
  if (current.length) {
    blocks.push({
      id: uid(),
      label: `Block ${blocks.length + 1}`,
      startTime: current[0].startTime,
      endTime: current[current.length - 1].endTime,
      words: current,
    });
  }
  return blocks;
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") {
    return errorEnvelope("Method not allowed", "METHOD_NOT_ALLOWED", 405);
  }

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    let userId = "00000000-0000-0000-0000-000000000000";
    if (token) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      );
      const { data: userRes } = await userClient.auth.getUser();
      if (userRes?.user) userId = userRes.user.id;
    }

    const body = await req.json() as { templateId?: string; force?: boolean };
    if (!body.templateId) {
      return errorEnvelope("templateId is required", "TEMPLATE_ID_REQUIRED", 400);
    }

    const admin = getSupabaseAdmin();
    const tpl = await admin.from("kanvas_lyric_templates")
      .select("*").eq("id", body.templateId).eq("user_id", userId).single();
    if (tpl.error) throw tpl.error;
    if (!body.force && tpl.data.lyric_blocks?.length) {
      return okEnvelope({ template: tpl.data });
    }

    const assetId = tpl.data.trimmed_audio_asset_id;
    if (!assetId) {
      return errorEnvelope("Template has no trimmed audio.", "TEMPLATE_AUDIO_MISSING", 400);
    }
    const asset = await admin.from("project_assets")
      .select("storage_bucket,storage_path").eq("id", assetId).single();
    if (asset.error) throw asset.error;
    const signed = await admin.storage.from(asset.data.storage_bucket)
      .createSignedUrl(asset.data.storage_path, 60 * 30);
    if (signed.error || !signed.data?.signedUrl) throw new Error("Could not sign audio URL");

    await admin.from("kanvas_lyric_templates")
      .update({ status: "lyrics_processing", error_message: null }).eq("id", body.templateId);
    const job = await admin.from("kanvas_lyric_template_jobs").insert({
      template_id: body.templateId, user_id: userId, kind: "transcribe",
      status: "running", provider: "gmi_cloud", started_at: new Date().toISOString(),
    }).select("id").single();

    const apiKey = Deno.env.get("GMI_CLOUD_API_KEY");
    let result: { words: Word[]; meta: Record<string, unknown> } | null = null;
    let errorMsg: string | null = null;
    if (!apiKey) {
      errorMsg = "GMI_CLOUD_API_KEY not configured. Use manual entry.";
    } else {
      try {
        result = await callGmiCloud(signed.data.signedUrl, apiKey);
        if (!result) errorMsg = "Transcription returned no words. Use manual entry.";
      } catch (e) {
        errorMsg = e instanceof Error ? e.message : String(e);
      }
    }

    if (!result) {
      await admin.from("kanvas_lyric_template_jobs").update({
        status: "failed", error_message: errorMsg, finished_at: new Date().toISOString(),
      }).eq("id", job.data?.id ?? "");
      const updated = await admin.from("kanvas_lyric_templates").update({
        status: "failed", error_message: errorMsg,
      }).eq("id", body.templateId).select("*").single();
      return okEnvelope({ template: updated.data });
    }

    const blocks = wordsToBlocks(result.words);
    await admin.from("kanvas_lyric_template_jobs").update({
      status: "succeeded", finished_at: new Date().toISOString(), response: { count: result.words.length },
    }).eq("id", job.data?.id ?? "");

    const updated = await admin.from("kanvas_lyric_templates").update({
      status: "lyrics_ready",
      lyric_blocks: blocks,
      transcript_meta: result.meta,
      error_message: null,
    }).eq("id", body.templateId).select("*").single();

    return okEnvelope({ template: updated.data });
  } catch (e) {
    return errorEnvelope(e, "KANVAS_LYRICS_TRANSCRIBE_FAILED", 500);
  }
});
