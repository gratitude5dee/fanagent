// Final render pass: takes the stitched stock_clip_url, optionally burns in
// lyric captions from the resolved kanvas_lyric_template via fal.ai
// ffmpeg-api/compose, then registers the rendered video as a media_asset and
// marks the item ready. No external Remotion host required.

import { errorResponse, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { composeWithSubtitles, extractFrame } from "../_shared/fal.ts";
import { downloadBytes, createMediaAssetFromBytes } from "../_shared/assets.ts";

type Word = {
  text?: string;
  word?: string;
  startMs?: number;
  endMs?: number;
  start?: number;
  end?: number;
};
type Block = { text?: string; startMs?: number; endMs?: number; words?: Word[] };

function fnUrl(name: string): string {
  return `${optionalEnv("SUPABASE_URL")}/functions/v1/${name}`;
}

async function finalizeLibraryItem(generationItemId: string): Promise<unknown> {
  const response = await fetch(fnUrl("library-finalize"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generationItemId }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`library-finalize failed [${response.status}]: ${JSON.stringify(json)}`);
  }
  return json;
}

function fmtTs(ms: number): string {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const cs = Math.floor(ms % 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(cs, 3)}`;
}

function blocksToSrt(blocks: Block[], selectionStartMs: number, totalSeconds: number): string {
  const totalMs = totalSeconds * 1000;
  const cues: { start: number; end: number; text: string }[] = [];
  for (const b of blocks ?? []) {
    const text = (b.text ?? (b.words ?? []).map((w) => w.text ?? w.word ?? "").join(" ")).trim();
    if (!text) continue;
    const startMs = b.startMs ?? b.words?.[0]?.startMs ?? 0;
    const endMs = b.endMs ?? b.words?.[b.words.length - 1]?.endMs ?? startMs + 1500;
    const s = startMs - selectionStartMs;
    const e = endMs - selectionStartMs;
    if (e <= 0 || s >= totalMs) continue;
    cues.push({ start: Math.max(0, s), end: Math.min(totalMs, e), text });
  }
  return cues
    .map((c, i) => `${i + 1}\n${fmtTs(c.start)} --> ${fmtTs(c.end)}\n${c.text}\n`)
    .join("\n");
}

Deno.serve(async (request) => {
  const opt = handleOptions(request);
  if (opt) return opt;
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await request.json()) as { itemId?: string };
    if (!body.itemId) throw new Error("itemId is required");

    const supabase = getSupabaseAdmin();
    const item = await supabase
      .from("generation_items")
      .select(
        "id,account_id,batch_id,stock_clip_url,input_payload,duration_seconds,lyric_template_id",
      )
      .eq("id", body.itemId)
      .single();
    if (item.error) throw item.error;
    if (!item.data.stock_clip_url) throw new Error("Item has no stock_clip_url; stitch first");

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

    if (lyricTemplateId) {
      const lt = await supabase
        .from("kanvas_lyric_templates")
        .select("id,lyric_blocks,selection_start_ms")
        .eq("id", lyricTemplateId)
        .maybeSingle();
      const blocks = (lt.data?.lyric_blocks ?? []) as Block[];
      if (blocks.length > 0) {
        const srt = blocksToSrt(blocks, lt.data!.selection_start_ms ?? 0, totalSeconds);
        // Upload SRT to public bucket so fal can fetch it.
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

    // Always download + re-host the final MP4 so posts never depend on
    // provider URLs or short-lived signed stock-cache URLs.
    const dl = await downloadBytes(finalUrl);
    const asset = await createMediaAssetFromBytes({
      accountId: item.data.account_id,
      kind: "rendered_video",
      source: provider,
      bytes: dl.bytes,
      mimeType: dl.mimeType === "application/octet-stream" ? "video/mp4" : dl.mimeType,
      fileName: `${body.itemId}.mp4`,
      metadata: {
        generation_item_id: body.itemId,
        lyric_template_id: lyricTemplateId,
        original_url: finalUrl,
      },
    });

    // Best-effort thumbnail extraction; never block readiness on failure.
    let thumbnailUrl: string | null = null;
    try {
      const frame = await extractFrame(finalUrl, "middle");
      thumbnailUrl = frame.url;
      await supabase
        .from("media_assets")
        .update({
          metadata: {
            ...(asset.metadata ?? {}),
            thumbnail_url: thumbnailUrl,
          },
        })
        .eq("id", asset.id);
    } catch (err) {
      console.warn(`[render-karaoke] extractFrame failed for ${body.itemId}: ${err}`);
    }

    const upd = await supabase
      .from("generation_items")
      .update({
        status: "ready",
        render_provider: provider,
        final_asset_id: asset.id,
      })
      .eq("id", body.itemId);
    if (upd.error) throw upd.error;

    const finalized = await finalizeLibraryItem(body.itemId);

    return jsonResponse({
      itemId: body.itemId,
      provider,
      finalAssetId: asset.id,
      url: asset.public_url,
      thumbnailUrl,
      finalized,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
