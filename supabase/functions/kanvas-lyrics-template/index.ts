// Action API for kanvas_lyric_templates. Owner-scoped via the caller's JWT,
// or via a shared anonymous user when the dashboard is unauthenticated.
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { transcriptToKanvasLyricBlocks } from "../_shared/lyrics.ts";
import type { Transcript } from "../_shared/transcribe.ts";

const ANON_USER_ID = "00000000-0000-0000-0000-000000000000";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") {
    return errorEnvelope("Method not allowed", "METHOD_NOT_ALLOWED", 405);
  }

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    let userId = ANON_USER_ID;
    let supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    if (token) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      );
      const { data: userRes } = await userClient.auth.getUser();
      if (userRes?.user) {
        userId = userRes.user.id;
        supabase = userClient;
      }
    }

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
        return okEnvelope({ template: ins.data });
      }
      case "createFromAudioClip": {
        const audioClipId = body.audioClipId as string | undefined;
        if (!audioClipId) {
          return errorEnvelope("audioClipId is required", "AUDIO_CLIP_ID_REQUIRED", 400);
        }

        const force = body.force === true;
        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const clip = await admin
          .from("audio_clips")
          .select("*")
          .eq("id", audioClipId)
          .single();
        if (clip.error) throw clip.error;

        if (!force && clip.data.default_lyric_template_id) {
          const existing = await supabase
            .from("kanvas_lyric_templates")
            .select("*")
            .eq("id", clip.data.default_lyric_template_id)
            .maybeSingle();
          if (existing.error) throw existing.error;
          if (existing.data) return okEnvelope({ template: existing.data });
        }

        const assetId = clip.data.trimmed_asset_id ?? clip.data.source_asset_id;
        const asset = await admin
          .from("media_assets")
          .select("id,transcript,file_name,mime_type,metadata")
          .eq("id", assetId)
          .single();
        if (asset.error) throw asset.error;

        const transcript = asset.data.transcript as Transcript | null;
        const lyricBlocks = transcript ? transcriptToKanvasLyricBlocks(transcript) : [];
        const hasLyrics = lyricBlocks.length > 0;
        const durationMs = Math.round(Number(clip.data.duration_sec ?? 15) * 1000);
        const title =
          typeof body.title === "string" && body.title.trim()
            ? body.title.trim()
            : `${clip.data.file_name ?? asset.data.file_name ?? "Audio clip"} lyrics`;

        const ins = await supabase
          .from("kanvas_lyric_templates")
          .insert({
            user_id: userId,
            title,
            source_audio_asset_id: null,
            trimmed_audio_asset_id: null,
            selection_start_ms: 0,
            selection_duration_ms: durationMs,
            total_duration_ms: durationMs,
            waveform_peaks: [],
            status: hasLyrics ? "lyrics_ready" : "audio_ready",
            lyric_blocks: lyricBlocks,
            transcript_meta: {
              provider: transcript ? "elevenlabs_scribe_v2" : null,
              language: transcript?.language ?? null,
              word_count: transcript?.words.length ?? 0,
              audio_clip_id: audioClipId,
              media_asset_id: asset.data.id,
              source_selection_start_sec: clip.data.selection_start_sec,
              source_selection_end_sec: clip.data.selection_end_sec,
            },
            render_defaults: {
              audio_clip_id: audioClipId,
              source: "fanagent_audio_clip",
            },
          })
          .select("*")
          .single();
        if (ins.error) throw ins.error;

        const updatedClip = await admin
          .from("audio_clips")
          .update({
            default_lyric_template_id: ins.data.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", audioClipId);
        if (updatedClip.error) throw updatedClip.error;

        return okEnvelope({ template: ins.data });
      }
      case "get": {
        const { data, error } = await supabase
          .from("kanvas_lyric_templates")
          .select("*")
          .eq("id", body.templateId as string)
          .single();
        if (error) throw error;
        return okEnvelope({ template: data });
      }
      case "list": {
        const { data, error } = await supabase
          .from("kanvas_lyric_templates")
          .select("*")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false });
        if (error) throw error;
        return okEnvelope({ templates: data });
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
        return okEnvelope({ template: data });
      }
      case "finalize": {
        const { data, error } = await supabase
          .from("kanvas_lyric_templates")
          .update({ status: "saved", saved_at: new Date().toISOString() })
          .eq("id", body.templateId as string)
          .select("*")
          .single();
        if (error) throw error;
        return okEnvelope({ template: data });
      }
      case "archive": {
        const { data, error } = await supabase
          .from("kanvas_lyric_templates")
          .update({ status: "archived", archived_at: new Date().toISOString() })
          .eq("id", body.templateId as string)
          .select("*")
          .single();
        if (error) throw error;
        return okEnvelope({ template: data });
      }
      default:
        return errorEnvelope(`Unknown action: ${body.action}`, "UNKNOWN_ACTION", 400);
    }
  } catch (e) {
    return errorEnvelope(e, "KANVAS_LYRICS_TEMPLATE_FAILED", 500);
  }
});
