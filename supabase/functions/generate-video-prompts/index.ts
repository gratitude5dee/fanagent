// Generates per-item video template prompts for a batch via Lovable AI Gateway
// (Gemini Flash 3.1) using tool calling for structured output. Overwrites the
// `prompt` and writes prompt metadata to `input_payload.prompt_meta` for each
// generation_item in the batch.

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

const SYSTEM = `You are a short-form video creative director. Given an audio
transcript, a visual theme, and a count, return that many distinct vertical
9:16 video shot ideas. Each idea is a stand-alone scene description that a
text-to-video model or stock footage searcher can use. Vary subject, pacing,
mood and camera angle so the resulting feed feels diverse.`;

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await request.json()) as { batchId?: string };
    if (!body.batchId) throw new Error("batchId is required");

    const supabase = getSupabaseAdmin();
    const batch = await supabase
      .from("generation_batches")
      .select("id,prompt,post_count,duration_seconds,audio_asset_id")
      .eq("id", body.batchId)
      .single();
    if (batch.error) throw batch.error;

    const audio = await supabase
      .from("media_assets")
      .select("transcript")
      .eq("id", batch.data.audio_asset_id)
      .maybeSingle();
    const transcript = audio.data?.transcript as { words?: Array<{ text: string }> } | null;
    const transcriptText =
      transcript?.words
        ?.map((w) => w.text)
        .join(" ")
        .slice(0, 1500) ?? "";

    const items = await supabase
      .from("generation_items")
      .select("id,item_index,input_payload")
      .eq("batch_id", body.batchId)
      .order("item_index", { ascending: true });
    if (items.error) throw items.error;
    const count = items.data?.length ?? batch.data.post_count;

    const apiKey = optionalEnv("LOVABLE_API_KEY");
    if (!apiKey) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "LOVABLE_API_KEY missing; deterministic prompts remain active.",
        count,
      });
    }

    const userPrompt = [
      `Theme: ${batch.data.prompt ?? "music-driven fan edit"}`,
      `Duration per video: ${batch.data.duration_seconds ?? 15}s`,
      `Audio transcript (may be lyrics): "${transcriptText}"`,
      `Generate ${count} distinct shot prompts.`,
    ].join("\n");

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-lite-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_prompts",
              description: "Submit the generated shot prompts.",
              parameters: {
                type: "object",
                properties: {
                  prompts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        shot: {
                          type: "string",
                          description: "Concrete vertical scene description, ~30 words.",
                        },
                        mood: { type: "string" },
                        visual_style: { type: "string" },
                        caption: {
                          type: "string",
                          description: "Short TikTok-style caption, <=80 chars.",
                        },
                      },
                      required: ["shot", "mood", "visual_style", "caption"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["prompts"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_prompts" } },
      }),
    });
    if (!aiRes.ok) {
      const t = await aiRes.text();
      if (aiRes.status === 429) throw new Error("AI rate limit; try again shortly.");
      if (aiRes.status === 402) throw new Error("AI credits exhausted.");
      throw new Error(`AI gateway ${aiRes.status}: ${t.slice(0, 300)}`);
    }
    const aiJson = await aiRes.json();
    const args = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    const prompts = (parsed?.prompts ?? []) as Array<{
      shot: string;
      mood: string;
      visual_style: string;
      caption: string;
    }>;

    if (prompts.length === 0) throw new Error("AI returned no prompts");

    // Write back to each item.
    for (let i = 0; i < (items.data ?? []).length; i += 1) {
      const item = items.data![i];
      const p = prompts[i % prompts.length];
      const payload = (item.input_payload ?? {}) as Record<string, unknown>;
      await supabase
        .from("generation_items")
        .update({
          prompt: p.shot,
          input_payload: { ...payload, prompt_meta: p },
        })
        .eq("id", item.id);
    }

    return jsonResponse({ ok: true, count: prompts.length, prompts });
  } catch (error) {
    return errorResponse(error);
  }
});
