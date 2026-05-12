// Verify storage object + register a project_assets row owned by the caller.
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { corsHeaders, errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return errorResponse("Missing auth", 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return errorResponse("Not authenticated", 401);
    const userId = userRes.user.id;

    const body = await req.json() as {
      storagePath: string;
      mimeType: string;
      fileName: string;
      byteSize: number;
      durationMs: number;
      kind?: "audio" | "audio_trimmed";
      bucket?: string;
    };

    const admin = getSupabaseAdmin();
    const bucket = body.bucket || "audio-uploads";
    // Verify object exists
    const head = await admin.storage.from(bucket).createSignedUrl(body.storagePath, 60);
    if (head.error || !head.data?.signedUrl) {
      return errorResponse(`Storage object not found: ${body.storagePath}`, 404);
    }

    const ins = await admin.from("project_assets").insert({
      user_id: userId,
      kind: body.kind ?? "audio_trimmed",
      storage_bucket: bucket,
      storage_path: body.storagePath,
      file_name: body.fileName,
      mime_type: body.mimeType,
      byte_size: body.byteSize,
      duration_ms: body.durationMs,
    }).select("id").single();
    if (ins.error) throw ins.error;

    const signed = await admin.storage.from(bucket).createSignedUrl(body.storagePath, 3600);
    return jsonResponse({ id: ins.data.id, signedUrl: signed.data?.signedUrl ?? null });
  } catch (e) {
    return errorResponse(e);
  }
});
// Re-export to avoid lint complaining about unused import
export const _ = corsHeaders;
