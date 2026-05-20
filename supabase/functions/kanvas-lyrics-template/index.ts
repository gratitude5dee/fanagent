// Action API for kanvas_lyric_templates. Owner-scoped via the caller's JWT,
// or via a shared anonymous user when the dashboard is unauthenticated.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.105.4";
import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { transcriptToKanvasLyricBlocks } from "../_shared/lyrics.ts";
import type { Transcript } from "../_shared/transcribe.ts";

const ANON_USER_ID = "00000000-0000-0000-0000-000000000000";

type AudioClipRow = {
  id: string;
  source_asset_id: string;
  trimmed_asset_id: string | null;
  default_lyric_template_id: string | null;
  duration_sec: number | null;
  file_name: string | null;
  selection_start_sec: number | null;
  selection_end_sec: number | null;
};

type MediaAssetRow = {
  id: string;
  transcript: Transcript | null;
  file_name: string | null;
  mime_type: string | null;
  metadata: Record<string, unknown> | null;
  storage_bucket: string;
  storage_path: string | null;
  byte_size: number | null;
  duration_seconds: number | null;
  public_url: string | null;
};

type LyricTemplateRow = {
  id: string;
  status: string;
  trimmed_audio_asset_id: string | null;
  lyric_blocks: unknown[] | null;
};

const AUDIO_CLIP_SELECT =
  "id,source_asset_id,trimmed_asset_id,default_lyric_template_id,duration_sec,file_name,selection_start_sec,selection_end_sec";
const MEDIA_ASSET_SELECT =
  "id,transcript,file_name,mime_type,metadata,storage_bucket,storage_path,byte_size,duration_seconds,public_url";

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function ensureProjectAssetForMediaAsset(input: {
  admin: SupabaseClient;
  asset: MediaAssetRow;
  userId: string;
  durationMs: number;
}): Promise<string> {
  const storagePath = nonEmptyString(input.asset.storage_path);
  if (!storagePath) {
    throw new Error("Audio clip media asset is missing storage_path.");
  }

  const existing = await input.admin
    .from("project_assets")
    .select("id")
    .eq("user_id", input.userId)
    .eq("storage_bucket", input.asset.storage_bucket)
    .eq("storage_path", storagePath)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) return String(existing.data.id);

  const inserted = await input.admin
    .from("project_assets")
    .insert({
      user_id: input.userId,
      kind: "audio_trimmed",
      storage_bucket: input.asset.storage_bucket,
      storage_path: storagePath,
      file_name: input.asset.file_name,
      mime_type: input.asset.mime_type,
      byte_size: input.asset.byte_size,
      duration_ms: input.durationMs,
      public_url: input.asset.public_url,
      metadata: {
        ...(input.asset.metadata ?? {}),
        source: "fanagent_audio_clip",
        source_media_asset_id: input.asset.id,
      },
    })
    .select("id")
    .single();
  if (inserted.error) throw inserted.error;
  return String(inserted.data.id);
}

function buildExistingTemplateRepair(input: {
  template: LyricTemplateRow;
  projectAssetId: string;
  lyricBlocks: ReturnType<typeof transcriptToKanvasLyricBlocks>;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!input.template.trimmed_audio_asset_id) {
    patch.trimmed_audio_asset_id = input.projectAssetId;
  }

  const hasExistingLyrics = Array.isArray(input.template.lyric_blocks)
    ? input.template.lyric_blocks.length > 0
    : false;
  if (!hasExistingLyrics && input.lyricBlocks.length > 0) {
    patch.lyric_blocks = input.lyricBlocks;
    patch.error_message = null;
    if (["draft", "audio_ready", "failed", "lyrics_processing"].includes(input.template.status)) {
      patch.status = "lyrics_ready";
    }
  }

  return patch;
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

    const body = (await req.json()) as { action: string; [k: string]: unknown };

    switch (body.action) {
      case "create": {
        const ins = await supabase
          .from("kanvas_lyric_templates")
          .insert({
            user_id: userId,
            title: (body.title as string) ?? "Untitled template",
            source_audio_asset_id: (body.sourceAssetId as string) ?? null,
            trimmed_audio_asset_id: (body.trimmedAssetId as string) ?? null,
            selection_start_ms: (body.selectionStartMs as number) ?? 0,
            selection_duration_ms: (body.selectionDurationMs as number) ?? 15000,
            total_duration_ms: (body.totalDurationMs as number) ?? 0,
            waveform_peaks: (body.waveformPeaks as number[]) ?? [],
          })
          .select("*")
          .single();
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
          .select(AUDIO_CLIP_SELECT)
          .eq("id", audioClipId)
          .single();
        if (clip.error) throw clip.error;
        const clipRow = clip.data as AudioClipRow;

        const assetId = clipRow.trimmed_asset_id ?? clipRow.source_asset_id;
        const asset = await admin
          .from("media_assets")
          .select(MEDIA_ASSET_SELECT)
          .eq("id", assetId)
          .single();
        if (asset.error) throw asset.error;
        const assetRow = asset.data as MediaAssetRow;

        const transcript = assetRow.transcript;
        const lyricBlocks = transcript ? transcriptToKanvasLyricBlocks(transcript) : [];
        const hasLyrics = lyricBlocks.length > 0;
        const durationMs = Math.round(
          Number(clipRow.duration_sec ?? assetRow.duration_seconds ?? 15) * 1000,
        );
        const projectAssetId = await ensureProjectAssetForMediaAsset({
          admin,
          asset: assetRow,
          userId,
          durationMs,
        });

        if (!force && clipRow.default_lyric_template_id) {
          const existing = await supabase
            .from("kanvas_lyric_templates")
            .select("*")
            .eq("id", clipRow.default_lyric_template_id)
            .maybeSingle();
          if (existing.error) throw existing.error;
          if (existing.data) {
            const patch = buildExistingTemplateRepair({
              template: existing.data as LyricTemplateRow,
              projectAssetId,
              lyricBlocks,
            });
            if (Object.keys(patch).length === 0) return okEnvelope({ template: existing.data });
            const repaired = await supabase
              .from("kanvas_lyric_templates")
              .update(patch)
              .eq("id", existing.data.id)
              .select("*")
              .single();
            if (repaired.error) throw repaired.error;
            return okEnvelope({ template: repaired.data });
          }
        }

        const title =
          typeof body.title === "string" && body.title.trim()
            ? body.title.trim()
            : `${clipRow.file_name ?? assetRow.file_name ?? "Audio clip"} lyrics`;

        const ins = await supabase
          .from("kanvas_lyric_templates")
          .insert({
            user_id: userId,
            title,
            source_audio_asset_id: null,
            trimmed_audio_asset_id: projectAssetId,
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
              media_asset_id: assetRow.id,
              project_asset_id: projectAssetId,
              source_selection_start_sec: clipRow.selection_start_sec,
              source_selection_end_sec: clipRow.selection_end_sec,
            },
            render_defaults: {
              audio_clip_id: audioClipId,
              project_asset_id: projectAssetId,
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
        const templateId = body.templateId as string;
        // Load template so we can bridge to an audio_clips row for downstream
        // generation pipelines that key off audio_clip_id.
        const tpl = await supabase
          .from("kanvas_lyric_templates")
          .select("*")
          .eq("id", templateId)
          .single();
        if (tpl.error) throw tpl.error;

        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        let audioClipId: string | null = tpl.data.audio_clip_id ?? null;
        const trimmedProjectAssetId =
          (tpl.data.trimmed_audio_asset_id as string | null) ??
          (tpl.data.source_audio_asset_id as string | null);

        // Resolve an account_id required by audio_clips / media_assets NOT NULL.
        async function resolveAccountId(): Promise<string | null> {
          const fromDefaults =
            (tpl.data.render_defaults as Record<string, unknown> | null)?.account_id;
          if (typeof fromDefaults === "string" && fromDefaults) return fromDefaults;
          const primary = await admin
            .from("accounts")
            .select("id")
            .eq("is_primary", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (primary.data?.id) return String(primary.data.id);
          const any = await admin
            .from("accounts")
            .select("id")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return any.data?.id ? String(any.data.id) : null;
        }

        let resolvedAccountId: string | null = null;

        if (!audioClipId && trimmedProjectAssetId) {
          resolvedAccountId = await resolveAccountId();
          if (!resolvedAccountId) {
            return errorEnvelope(
              "No account is configured. Connect a TikTok account before saving a lyric template.",
              "KANVAS_LYRICS_TEMPLATE_NO_ACCOUNT",
              400,
            );
          }
          const projAsset = await admin
            .from("project_assets")
            .select(
              "id,storage_bucket,storage_path,file_name,mime_type,byte_size,duration_ms,public_url,metadata",
            )
            .eq("id", trimmedProjectAssetId)
            .single();
          if (projAsset.error) throw projAsset.error;

          const existingMedia = await admin
            .from("media_assets")
            .select("id")
            .eq("storage_bucket", projAsset.data.storage_bucket)
            .eq("storage_path", projAsset.data.storage_path)
            .limit(1)
            .maybeSingle();
          if (existingMedia.error) throw existingMedia.error;

          let mediaAssetId = existingMedia.data?.id as string | undefined;
          if (!mediaAssetId) {
            const inserted = await admin
              .from("media_assets")
              .insert({
                account_id: resolvedAccountId,
                kind: "audio",
                source: "lyric_template",
                storage_bucket: projAsset.data.storage_bucket,
                storage_path: projAsset.data.storage_path,
                public_url: projAsset.data.public_url ?? "",
                file_name: projAsset.data.file_name,
                mime_type: projAsset.data.mime_type,
                byte_size: projAsset.data.byte_size,
                duration_seconds: (projAsset.data.duration_ms ?? 0) / 1000,
                metadata: {
                  ...(projAsset.data.metadata ?? {}),
                  bridged_from_project_asset_id: projAsset.data.id,
                  bridged_for_lyric_template_id: templateId,
                },
              })
              .select("id")
              .single();
            if (inserted.error) throw inserted.error;
            mediaAssetId = String(inserted.data.id);
          }

          const durationSec = Math.max(
            1,
            Math.round(
              (Number(tpl.data.selection_duration_ms ?? 0) ||
                Number(projAsset.data.duration_ms ?? 0)) / 1000,
            ),
          );
          const clipIns = await admin
            .from("audio_clips")
            .insert({
              account_id: resolvedAccountId,
              source_asset_id: mediaAssetId,
              trimmed_asset_id: mediaAssetId,
              selection_start_sec: Number(tpl.data.selection_start_ms ?? 0) / 1000,
              selection_end_sec:
                (Number(tpl.data.selection_start_ms ?? 0) +
                  Number(tpl.data.selection_duration_ms ?? 0)) /
                1000,
              duration_sec: durationSec,
              file_name: projAsset.data.file_name,
              transcription_status: Array.isArray(tpl.data.lyric_blocks)
                ? "completed"
                : "pending",
              default_lyric_template_id: templateId,
              lyric_template_id: templateId,
              metadata: { created_from: "kanvas-lyrics-template:finalize" },
            })
            .select("id")
            .single();
          if (clipIns.error) throw clipIns.error;
          audioClipId = String(clipIns.data.id);
        }

        const mergedDefaults = {
          ...((tpl.data.render_defaults as Record<string, unknown>) ?? {}),
          ...(resolvedAccountId ? { account_id: resolvedAccountId } : {}),
        };

        const { data, error } = await supabase
          .from("kanvas_lyric_templates")
          .update({
            status: "saved",
            saved_at: new Date().toISOString(),
            audio_clip_id: audioClipId,
            render_defaults: mergedDefaults,
          })
          .eq("id", templateId)
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
      case "patchRenderDefaults": {
        const renderDefaults = (body.renderDefaults as Record<string, unknown>) ?? {};
        // Merge into existing render_defaults to avoid clobbering keys.
        const current = await supabase
          .from("kanvas_lyric_templates")
          .select("render_defaults")
          .eq("id", body.templateId as string)
          .single();
        if (current.error) throw current.error;
        const merged = { ...(current.data.render_defaults ?? {}), ...renderDefaults };
        const { data, error } = await supabase
          .from("kanvas_lyric_templates")
          .update({ render_defaults: merged })
          .eq("id", body.templateId as string)
          .select("*")
          .single();
        if (error) throw error;
        return okEnvelope({ template: data });
      }
      case "signTrimmedAudio": {
        // Returns a fresh signed URL for the template's trimmed audio asset.
        // Runs with service-role so it bypasses project_assets RLS (templates
        // created under the anon sentinel user can't be read from the browser).
        const templateId = body.templateId as string;
        if (!templateId) {
          return errorEnvelope("templateId is required", "TEMPLATE_ID_REQUIRED", 400);
        }
        const ttlSec = typeof body.ttlSec === "number" ? Math.max(60, Math.min(86400, body.ttlSec)) : 3600;
        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const tpl = await admin
          .from("kanvas_lyric_templates")
          .select("id,trimmed_audio_asset_id,source_audio_asset_id,transcript_meta,render_defaults")
          .eq("id", templateId)
          .single();
        if (tpl.error) throw tpl.error;

        let assetId: string | null =
          (tpl.data.trimmed_audio_asset_id as string | null) ??
          (tpl.data.source_audio_asset_id as string | null);

        const tryFetchAsset = async (id: string) => {
          const r = await admin
            .from("project_assets")
            .select("storage_bucket,storage_path")
            .eq("id", id)
            .maybeSingle();
          if (r.error) throw r.error;
          return r.data && r.data.storage_path ? r.data : null;
        };

        let asset = assetId ? await tryFetchAsset(assetId) : null;

        // Fallback: rebuild the project_asset row from the linked media_asset.
        if (!asset) {
          const meta = (tpl.data.transcript_meta ?? {}) as Record<string, unknown>;
          const renderDefaults = (tpl.data.render_defaults ?? {}) as Record<string, unknown>;
          const mediaAssetId =
            (typeof meta.media_asset_id === "string" && meta.media_asset_id) ||
            (typeof renderDefaults.media_asset_id === "string" && renderDefaults.media_asset_id) ||
            null;
          if (mediaAssetId) {
            const ma = await admin
              .from("media_assets")
              .select(MEDIA_ASSET_SELECT)
              .eq("id", mediaAssetId)
              .single();
            if (ma.error) throw ma.error;
            const newAssetId = await ensureProjectAssetForMediaAsset({
              admin,
              asset: ma.data as MediaAssetRow,
              userId,
              durationMs: Math.round(Number(ma.data?.duration_seconds ?? 0) * 1000) || 15000,
            });
            await admin
              .from("kanvas_lyric_templates")
              .update({ trimmed_audio_asset_id: newAssetId })
              .eq("id", templateId);
            assetId = newAssetId;
            asset = await tryFetchAsset(newAssetId);
          }
        }

        if (!asset) {
          return errorEnvelope(
            "No storage object available for this template.",
            "TEMPLATE_AUDIO_MISSING",
            404,
          );
        }

        const signed = await admin.storage
          .from(asset.storage_bucket)
          .createSignedUrl(asset.storage_path!, ttlSec);
        if (signed.error || !signed.data?.signedUrl) {
          throw signed.error ?? new Error("Failed to sign trimmed audio URL");
        }
        return okEnvelope({
          signedUrl: signed.data.signedUrl,
          expiresInSec: ttlSec,
          assetId,
        });
      }
      default:
        return errorEnvelope(`Unknown action: ${body.action}`, "UNKNOWN_ACTION", 400);
    }
  } catch (e) {
    return errorEnvelope(e, "KANVAS_LYRICS_TEMPLATE_FAILED", 500);
  }
});
