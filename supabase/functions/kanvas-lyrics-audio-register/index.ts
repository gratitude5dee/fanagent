// Verify storage object + register a project_assets row owned by the caller.
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

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

    const body = await req.json() as {
      storagePath?: string;
      mimeType?: string;
      fileName?: string;
      byteSize?: number;
      durationMs?: number;
      kind?: "audio" | "audio_trimmed";
      bucket?: string;
    };
    if (
      !body.storagePath ||
      !body.mimeType ||
      !body.fileName ||
      typeof body.byteSize !== "number" ||
      typeof body.durationMs !== "number"
    ) {
      return errorEnvelope(
        "storagePath, mimeType, fileName, byteSize, and durationMs are required",
        "AUDIO_REGISTER_REQUEST_INVALID",
        400,
      );
    }

    const admin = getSupabaseAdmin();
    const bucket = body.bucket || "audio-uploads";
    // Verify object exists
    const head = await admin.storage.from(bucket).createSignedUrl(body.storagePath, 60);
    if (head.error || !head.data?.signedUrl) {
      return errorEnvelope(
        `Storage object not found: ${body.storagePath}`,
        "STORAGE_OBJECT_NOT_FOUND",
        404,
      );
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
    return okEnvelope({ id: ins.data.id, signedUrl: signed.data?.signedUrl ?? null });
  } catch (e) {
    return errorEnvelope(e, "KANVAS_LYRICS_AUDIO_REGISTER_FAILED", 500);
  }
});
