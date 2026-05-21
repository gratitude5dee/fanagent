// Final render pass: takes the stitched stock_clip_url, optionally burns in
// lyric captions from the resolved kanvas_lyric_template via fal.ai
// ffmpeg-api/compose, then registers the rendered video as a media_asset and
// marks the item ready. No external Remotion host required.

import { handleOptions } from "../_shared/cors.ts";
import { errorEnvelope, okEnvelope } from "../_shared/envelope.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { composeWithSubtitles, extractFrame } from "../_shared/fal.ts";
import { contentFingerprint64 } from "../_shared/hash.ts";
import { isAuthorizedInternalCall } from "../_shared/internal.ts";
import { withRenderAttempt } from "../_shared/render-attempts.ts";
import {
  createMediaAssetFromBytes,
  downloadBytes,
  renderedVideoSignedUrlSeconds,
  renderedVideoStoragePath,
} from "../_shared/assets.ts";
import { blocksToAss, blocksToSrt, type RenderLyricBlock } from "../_shared/lyrics.ts";
import { pickFont } from "../_shared/fonts.ts";

type GenerationItemRow = {
  id: string;
  account_id: string;
  batch_id: string;
  stock_clip_url: string;
  input_payload: unknown;
  duration_seconds: number | null;
  lyric_template_id: string | null;
  library_item_id: string | null;
  audio_clip_id: string | null;
  item_index: number | null;
};

function fnUrl(name: string): string {
  return `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
}

async function finalizeLibraryItem(generationItemId: string): Promise<unknown> {
  const response = await fetch(fnUrl("library-finalize"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": optionalEnv("CRON_SECRET") ?? "",
    },
    body: JSON.stringify({ generationItemId }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`library-finalize failed [${response.status}]: ${JSON.stringify(json)}`);
  }
  return json;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function libraryItemIdFromFinalize(value: unknown): string | null {
  const envelope = record(value);
  const data = record(envelope.data ?? envelope);
  const libraryItem = record(data.library_item);
  return typeof libraryItem.id === "string" && libraryItem.id ? libraryItem.id : null;
}

async function resolveLibraryItemId(item: GenerationItemRow): Promise<string> {
  if (item.library_item_id) return item.library_item_id;
  if (!item.audio_clip_id) {
    throw new Error("generation item is missing library_item_id and audio_clip_id.");
  }

  const supabase = getSupabaseAdmin();
  const existing = await supabase
    .from("video_library_items")
    .select("id")
    .eq("generation_item_id", item.id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) return existing.data.id;

  const slot = await supabase
    .from("video_library_items")
    .select("id")
    .eq("batch_id", item.batch_id)
    .eq("audio_clip_id", item.audio_clip_id)
    .eq("library_index", item.item_index ?? 0)
    .maybeSingle();
  if (slot.error) throw slot.error;
  if (!slot.data?.id) {
    const inserted = await supabase
      .from("video_library_items")
      .insert({
        account_id: item.account_id,
        audio_clip_id: item.audio_clip_id,
        batch_id: item.batch_id,
        generation_item_id: item.id,
        library_index: item.item_index ?? 0,
        status: "not_ready",
        duration_sec: item.duration_seconds ?? 15,
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    const updatedItem = await supabase
      .from("generation_items")
      .update({ library_item_id: inserted.data.id, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (updatedItem.error) throw updatedItem.error;
    return inserted.data.id;
  }

  const updatedItem = await supabase
    .from("generation_items")
    .update({ library_item_id: slot.data.id, updated_at: new Date().toISOString() })
    .eq("id", item.id);
  if (updatedItem.error) throw updatedItem.error;

  const updatedSlot = await supabase
    .from("video_library_items")
    .update({ generation_item_id: item.id, updated_at: new Date().toISOString() })
    .eq("id", slot.data.id);
  if (updatedSlot.error) throw updatedSlot.error;

  return slot.data.id;
}

async function uploadThumbnailFrame(input: {
  libraryItemId: string;
  frameUrl: string;
}): Promise<{ publicUrl: string; storagePath: string }> {
  const supabase = getSupabaseAdmin();
  const frame = await downloadBytes(input.frameUrl);
  const mimeType = frame.mimeType === "application/octet-stream" ? "image/png" : frame.mimeType;
  const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("png") ? "png" : "jpg";
  const storagePath = `thumbnails/${input.libraryItemId}.${extension}`;
  const upload = await supabase.storage.from("thumbnails").upload(storagePath, frame.bytes, {
    contentType: mimeType,
    cacheControl: "31536000",
    upsert: true,
  });
  if (upload.error) throw upload.error;

  const { data } = supabase.storage.from("thumbnails").getPublicUrl(storagePath);
  return { publicUrl: data.publicUrl, storagePath };
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") {
    return errorEnvelope("Method not allowed", "METHOD_NOT_ALLOWED", 405);
  }
  if (!isAuthorizedInternalCall(request)) {
    return errorEnvelope("Unauthorized internal call.", "UNAUTHORIZED_INTERNAL", 401);
  }

  try {
    const body = (await request.json()) as { itemId?: string };
    if (!body.itemId) throw new Error("itemId is required");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select(
        "id,account_id,batch_id,stock_clip_url,input_payload,duration_seconds,lyric_template_id,library_item_id,audio_clip_id,item_index",
      )
      .eq("id", body.itemId)
      .single();
    if (item.error) throw item.error;
    if (!item.data.stock_clip_url) throw new Error("Item has no stock_clip_url; stitch first");
    const generationItem = item.data as GenerationItemRow;
    const libraryItemId = await resolveLibraryItemId(generationItem);

    const batch = await supabase
      .from("generation_batches")
      .select("audio_asset_id,lyric_template_id")
      .eq("id", item.data.batch_id)
      .single();
    if (batch.error) throw batch.error;

    const audio = await supabase
      .from("media_assets")
      .select("public_url")
      .eq("id", batch.data.audio_asset_id)
      .single();
    if (audio.error) throw audio.error;

    const totalSeconds = item.data.duration_seconds ?? 15;
    const lyricTemplateId = item.data.lyric_template_id ?? batch.data.lyric_template_id ?? null;

    let finalUrl: string = item.data.stock_clip_url;
    let provider = "passthrough";

    const rendered = await withRenderAttempt(
      {
        generationItemId: body.itemId,
        stage: "karaoke",
        provider: "fal_ffmpeg",
        detail: {
          action: "render-karaoke",
          lyric_template_id: lyricTemplateId,
          library_item_id: libraryItemId,
          idempotency_key: `${body.itemId}:karaoke`,
        },
      },
      async () => {
        if (lyricTemplateId) {
          const lt = await supabase
            .from("kanvas_lyric_templates")
            .select("id,lyric_blocks,selection_start_ms")
            .eq("id", lyricTemplateId)
            .maybeSingle();
          const blocks = (lt.data?.lyric_blocks ?? []) as RenderLyricBlock[];
          if (blocks.length > 0) {
            const font = pickFont(body.itemId!);
            const ass = blocksToAss(
              blocks,
              lt.data!.selection_start_ms ?? 0,
              totalSeconds,
              {
                fontName: font.name,
                fontWeight: font.weight,
                primaryColour: font.primaryColour,
                outlineColour: font.outlineColour,
              },
            );
            const assPath = `subtitles/${body.itemId}-${Date.now()}.ass`;
            const upAss = await supabase.storage
              .from("post-assets")
              .upload(assPath, new TextEncoder().encode(ass), {
                contentType: "text/x-ssa",
                upsert: true,
              });
            if (upAss.error) throw upAss.error;
            const { data: pubAss } = supabase.storage.from("post-assets").getPublicUrl(assPath);
            try {
              finalUrl = await composeWithSubtitles({
                videoUrl: item.data.stock_clip_url,
                audioUrl: audio.data.public_url,
                subtitlesUrl: pubAss.publicUrl,
                totalSeconds,
              });
              provider = "fal_ffmpeg";
            } catch (assErr) {
              // libass rejected the ASS file (rare). Fall back to plain SRT
              // so we still ship the video — font variation is preserved as
              // a metadata badge even when the visual font is uniform.
              console.warn(
                `[render-karaoke] ASS compose failed, falling back to SRT: ${assErr}`,
              );
              const srt = blocksToSrt(blocks, lt.data!.selection_start_ms ?? 0, totalSeconds);
              const srtPath = `subtitles/${body.itemId}-${Date.now()}.srt`;
              const up = await supabase.storage
                .from("post-assets")
                .upload(srtPath, new TextEncoder().encode(srt), {
                  contentType: "application/x-subrip",
                  upsert: true,
                });
              if (up.error) throw up.error;
              const { data: pub } = supabase.storage.from("post-assets").getPublicUrl(srtPath);
              finalUrl = await composeWithSubtitles({
                videoUrl: item.data.stock_clip_url,
                audioUrl: audio.data.public_url,
                subtitlesUrl: pub.publicUrl,
                totalSeconds,
              });
              provider = "fal_ffmpeg";
            }
          }
        }

        // Always download + re-host the final MP4 so posts never depend on
        // provider URLs or short-lived signed stock-cache URLs.
        const dl = await downloadBytes(finalUrl);
        const perceptualHash = await contentFingerprint64(dl.bytes);
        const asset = await createMediaAssetFromBytes({
          accountId: generationItem.account_id,
          kind: "rendered_video",
          source: provider,
          bytes: dl.bytes,
          mimeType: dl.mimeType === "application/octet-stream" ? "video/mp4" : dl.mimeType,
          fileName: `${libraryItemId}.mp4`,
          storageBucket: "renders",
          storagePath: renderedVideoStoragePath(generationItem.account_id, libraryItemId),
          publicUrlMode: "signed",
          signedUrlExpiresIn: renderedVideoSignedUrlSeconds,
          upsert: true,
          metadata: {
            generation_item_id: body.itemId,
            library_item_id: libraryItemId,
            lyric_template_id: lyricTemplateId,
            original_url: finalUrl,
            perceptual_hash: perceptualHash,
            perceptual_hash_kind: "sha256_64_content_fingerprint",
            signed_url_expires_in_seconds: renderedVideoSignedUrlSeconds,
          },
        });

        return { finalUrl, provider, asset, perceptualHash };
      },
    );

    const upd = await supabase
      .from("generation_items")
      .update({
        status: "ready",
        render_provider: rendered.provider,
        final_asset_id: rendered.asset.id,
        perceptual_hash: rendered.perceptualHash,
      })
      .eq("id", body.itemId);
    if (upd.error) throw upd.error;

    // Persist the chosen font name on the library item so the UI can show a
    // "Font: <name>" chip on each tile (and confirm visible per-video variation).
    if (lyricTemplateId) {
      const font = pickFont(body.itemId);
      const existing = await supabase
        .from("video_library_items")
        .select("metadata")
        .eq("id", libraryItemId)
        .maybeSingle();
      const baseMetadata = (existing.data?.metadata ?? {}) as Record<string, unknown>;
      await supabase
        .from("video_library_items")
        .update({
          metadata: { ...baseMetadata, lyric_font: font.name },
          updated_at: new Date().toISOString(),
        })
        .eq("id", libraryItemId);
    }

    const finalized = await withRenderAttempt(
      {
        generationItemId: body.itemId,
        stage: "finalize",
        provider: "library-finalize",
        detail: {
          action: "library-finalize",
          library_item_id: libraryItemId,
        },
      },
      () => finalizeLibraryItem(body.itemId!),
    );
    const finalizedLibraryItemId = libraryItemIdFromFinalize(finalized) ?? libraryItemId;

    // Best-effort thumbnail extraction; never block readiness on failure.
    let thumbnailUrl: string | null = null;
    try {
      const thumbnail = await withRenderAttempt(
        {
          generationItemId: body.itemId,
          stage: "thumbnail",
          provider: "fal_ffmpeg",
          detail: {
            action: "extract-frame",
            library_item_id: finalizedLibraryItemId,
          },
        },
        async () => {
          const frame = await extractFrame(rendered.asset.public_url, "middle");
          return uploadThumbnailFrame({
            libraryItemId: finalizedLibraryItemId,
            frameUrl: frame.url,
          });
        },
      );
      thumbnailUrl = thumbnail.publicUrl;
      await supabase
        .from("media_assets")
        .update({
          metadata: {
            ...(rendered.asset.metadata ?? {}),
            thumbnail_url: thumbnailUrl,
            thumbnail_storage_bucket: "thumbnails",
            thumbnail_storage_path: thumbnail.storagePath,
          },
        })
        .eq("id", rendered.asset.id);
      await supabase
        .from("video_library_items")
        .update({ thumbnail_url: thumbnailUrl, updated_at: new Date().toISOString() })
        .eq("id", finalizedLibraryItemId);
    } catch (err) {
      console.warn(`[render-karaoke] extractFrame failed for ${body.itemId}: ${err}`);
    }

    return okEnvelope({
      itemId: body.itemId,
      provider: rendered.provider,
      finalAssetId: rendered.asset.id,
      url: rendered.asset.public_url,
      thumbnailUrl,
      finalized,
    });
  } catch (error) {
    return errorEnvelope(error, "RENDER_KARAOKE_FAILED", 500);
  }
});
