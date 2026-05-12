// Action API for kanvas_lyric_templates. Owner-scoped via the caller's JWT.
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return errorResponse("Missing auth", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) return errorResponse("Not authenticated", 401);
    const userId = userRes.user.id;

    const body = await req.json() as { action: string; [k: string]: unknown };

    switch (body.action) {
      case "create": {
        const ins = await supabase.from("kanvas_lyric_templates").insert({
          user_id: userId,
          title: (body.title as string) ?? "Untitled template",
          source_audio_asset_id: (body.sourceAssetId as string) ?? null,
          trimmed_audio_asset_id: (body.trimmedAssetId as string) ?? null,
          selection_start_ms: (body.selectionStartMs as number) ?? 0,
          selection_duration_ms: (body.selectionDurationMs as number) ?? 15000,
          total_duration_ms: (body.totalDurationMs as number) ?? 0,
          waveform_peaks: (body.waveformPeaks as number[]) ?? [],
        }).select("*").single();
        if (ins.error) throw ins.error;
        return jsonResponse({ template: ins.data });
      }
      case "get": {
        const { data, error } = await supabase
          .from("kanvas_lyric_templates")
          .select("*")
          .eq("id", body.templateId as string)
          .single();
        if (error) throw error;
        return jsonResponse({ template: data });
      }
      case "list": {
        const { data, error } = await supabase
          .from("kanvas_lyric_templates")
          .select("*")
          .order("updated_at", { ascending: false });
        if (error) throw error;
        return jsonResponse({ templates: data });
      }
      case "patch": {
        const patch = (body.patch as Record<string, unknown>) ?? {};
        const { data, error } = await supabase
          .from("kanvas_lyric_templates")
          .update(patch)
          .eq("id", body.templateId as string)
          .select("*")
          .single();
        if (error) throw error;
        return jsonResponse({ template: data });
      }
      case "finalize": {
        const { data, error } = await supabase
          .from("kanvas_lyric_templates")
          .update({ status: "saved", saved_at: new Date().toISOString() })
          .eq("id", body.templateId as string)
          .select("*")
          .single();
        if (error) throw error;
        return jsonResponse({ template: data });
      }
      case "archive": {
        const { data, error } = await supabase
          .from("kanvas_lyric_templates")
          .update({ status: "archived", archived_at: new Date().toISOString() })
          .eq("id", body.templateId as string)
          .select("*")
          .single();
        if (error) throw error;
        return jsonResponse({ template: data });
      }
      default:
        return errorResponse(`Unknown action: ${body.action}`, 400);
    }
  } catch (e) {
    return errorResponse(e);
  }
});
