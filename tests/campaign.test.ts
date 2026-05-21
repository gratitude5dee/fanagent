import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCampaignCreateBatchPayload,
  normalizeCampaignCreateResponse,
} from "../supabase/functions/_shared/campaign.ts";
import { unwrapEnvelopeData } from "../supabase/functions/_shared/envelope.ts";

describe("campaign create payload normalization", () => {
  it("maps the GenViral create payload into create-generation-batch input", () => {
    const payload = buildCampaignCreateBatchPayload({
      action: "create",
      accountId: "account-1",
      audioClipId: "clip-1",
      lyricTemplateId: "template-1",
      quantity: 20,
      sourceMode: "streamer_clip",
      prompt: "behind the scenes vertical edits",
      sourceSettings: {
        stock: {
          providers: ["library", "pexels"],
          portraitOnly: true,
        },
        seedance: {
          resolution: "1080p",
        },
        streamer_clip: {
          channel: "creator",
        },
      },
      schedule: {
        startAt: "2026-05-19T12:00:00.000Z",
        cadenceMinutes: 1440,
        timezone: "America/New_York",
      },
      publishDefaults: {
        privacyLevel: "SELF_ONLY",
        isAigc: true,
      },
      durationTolerance: {
        preferredSeconds: 5,
        fallbackSeconds: 10,
      },
      dedupeStrategy: "allow_reuse_after_exhaustion",
    });

    expect(payload).toMatchObject({
      accountId: "account-1",
      audioClipId: "clip-1",
      lyricTemplateId: "template-1",
      quantity: 20,
      count: 20,
      sourceMode: "streamer_clip",
      prompt: "behind the scenes vertical edits",
      startAt: "2026-05-19T12:00:00.000Z",
      cadenceMinutes: 1440,
      timezone: "America/New_York",
      publishDefaults: {
        privacyLevel: "SELF_ONLY",
        isAigc: true,
      },
      durationTolerance: {
        preferredSeconds: 5,
        fallbackSeconds: 10,
      },
      dedupeStrategy: "allow_reuse_after_exhaustion",
    });
    expect(payload.stockSettings).toEqual({
      providers: ["library", "pexels"],
      portraitOnly: true,
      channel: "creator",
    });
    expect(payload.seedanceSettings).toEqual({
      resolution: "1080p",
    });
  });

  it("preserves adapter-specific settings for gated source modes", () => {
    const streamerPayload = buildCampaignCreateBatchPayload({
      accountId: "account-1",
      audioClipId: "clip-1",
      sourceMode: "streamer_clip",
      sourceSettings: {
        stock: {
          portraitOnly: true,
          negativeKeywords: ["logo"],
        },
        streamer_clip: {
          streamer: "creator",
          allowedChannels: ["creator", "teammate"],
        },
      },
    });

    expect(streamerPayload.stockSettings).toEqual({
      portraitOnly: true,
      negativeKeywords: ["logo"],
      streamer: "creator",
      allowedChannels: ["creator", "teammate"],
    });

    const sportsPayload = buildCampaignCreateBatchPayload({
      accountId: "account-1",
      audioClipId: "clip-1",
      sourceMode: "sports_edit",
      sourceSettings: {
        stock: {
          portraitOnly: true,
        },
        sports_edit: {
          league: "WNBA",
          team: "Liberty",
          allowedChannels: ["UCofficial"],
          ownerAssetUrls: {
            "video-1": "https://assets.example.com/video-1.mp4",
          },
        },
      },
    });

    expect(sportsPayload.stockSettings).toEqual({
      portraitOnly: true,
      league: "WNBA",
      team: "Liberty",
      allowedChannels: ["UCofficial"],
      ownerAssetUrls: {
        "video-1": "https://assets.example.com/video-1.mp4",
      },
    });
  });

  it("keeps legacy campaign payloads compatible", () => {
    const payload = buildCampaignCreateBatchPayload({
      accountId: "account-1",
      audioBase64: "Zm9v",
      audioMimeType: "audio/wav",
      audioFileName: "hook.wav",
      postCount: 14,
      sourceMode: "stock",
      cadenceMinutes: 720,
      durationSeconds: 30,
      startAt: "2026-05-20T09:00:00.000Z",
      stockSettings: {
        keywords: ["concert"],
      },
      seedanceSettings: {
        resolution: "720p",
      },
    });

    expect(payload).toMatchObject({
      accountId: "account-1",
      audioBase64: "Zm9v",
      audioMimeType: "audio/wav",
      audioFileName: "hook.wav",
      postCount: 14,
      quantity: 14,
      count: 14,
      sourceMode: "stock",
      cadenceMinutes: 720,
      durationSeconds: 30,
      startAt: "2026-05-20T09:00:00.000Z",
      stockSettings: {
        keywords: ["concert"],
      },
      seedanceSettings: {
        resolution: "720p",
      },
    });
  });
});

describe("campaign response envelopes", () => {
  it("unwraps successful envelopes while accepting legacy raw bodies", () => {
    expect(
      unwrapEnvelopeData({
        success: true,
        code: "OK",
        message: "OK",
        data: { ok: true },
        error: null,
        errorDetail: null,
      }),
    ).toEqual({ ok: true });

    expect(unwrapEnvelopeData({ ok: true })).toEqual({ ok: true });
  });

  it("throws human-readable errors for failed envelopes", () => {
    expect(() =>
      unwrapEnvelopeData({
        success: false,
        code: "TIKTOK_NOT_CONNECTED",
        message: "Connect TikTok first",
        data: null,
        error: "TikTok is not connected",
        errorDetail: { message: "creator info missing" },
      }),
    ).toThrow("TikTok is not connected");
  });

  it("normalizes create-generation-batch output into the campaign response contract", () => {
    const normalized = normalizeCampaignCreateResponse({
      batch: { id: "batch-1" },
      audioClip: { id: "clip-1" },
      audioAsset: { id: "asset-1" },
      video_library_items: [{ id: "library-1" }],
      items: [{ id: "item-1" }, { id: "item-2" }],
    });

    expect(normalized).toEqual({
      batch: { id: "batch-1" },
      audio_clip: { id: "clip-1" },
      audio_asset: { id: "asset-1" },
      video_library_items: [{ id: "library-1" }],
      items: [{ id: "item-1" }, { id: "item-2" }],
      items_total: 2,
    });
  });

  it("returns the spec snake_case audio objects from create-generation-batch", () => {
    const source = readFileSync("supabase/functions/create-generation-batch/index.ts", "utf8");

    expect(source).toContain("audio_clip: audioClip");
    expect(source).toContain("audio_asset: audioAsset");
    expect(source).toContain("audioClip");
    expect(source).toContain("audioAsset");
    expect(source).toContain("resolveLyricTemplateBinding");
    expect(source).toContain("Lyric template must be saved before generating a library.");
    expect(source).toContain("Lyric template does not belong to the provided audio clip.");
    expect(source).toContain("assertTemplateMatchesAudioClip");
  });

  it("keeps create-generation-batch on the envelope contract", () => {
    const source = readFileSync("supabase/functions/create-generation-batch/index.ts", "utf8");
    const campaignSource = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");
    const appSource = readFileSync("src/App.tsx", "utf8");

    expect(source).toContain("okEnvelope({");
    expect(source).toContain('errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405)');
    expect(source).toContain('import { isAuthorizedInternalCall } from "../_shared/internal.ts"');
    expect(source).toContain("if (!isAuthorizedInternalCall(request))");
    expect(source).toContain(
      'errorEnvelope("Unauthorized internal call.", "UNAUTHORIZED_INTERNAL", 401)',
    );
    expect(source).toContain('"CREATE_GENERATION_BATCH_FAILED"');
    expect(campaignSource).toContain('"x-cron-secret": cronSecret');
    expect(appSource).toContain('invokeFunction("fanpage-campaign"');
    expect(appSource).toContain('action: "create"');
    expect(appSource).not.toContain('invokeFunction("create-generation-batch"');
    expect(source).not.toContain("return jsonResponse({");
    expect(source).not.toContain("return errorResponse(error)");
  });

  it("accepts the full audio MIME set from the Create upload flow", () => {
    const source = readFileSync("supabase/functions/create-generation-batch/index.ts", "utf8");

    expect(source).toContain('"audio/flac"');
    expect(source).toContain('"audio/x-flac"');
  });

  it("keeps the campaign list response scoped to UI fields", () => {
    const source = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");

    expect(source).toContain(
      '"id,title,status,audio_clip_id,trimmed_audio_asset_id,total_duration_ms,selection_duration_ms,lyric_blocks,cut_markers,updated_at"',
    );
    expect(source).toContain("summarizeLyricTemplates");
    expect(source).toContain("word_count: countTemplateWords(template.lyric_blocks)");
    expect(source).toContain("cut_marker_count: cutMarkers.length");
    expect(source).toContain(
      '"id,account_id,batch_id,item_index,library_item_id,status,scheduled_at,provider,prompt,segments,stock_clip_url,render_provider,error_message,lyric_template_id,stage_events"',
    );
    expect(source).toContain(
      '"id,batch_id,generation_item_id,library_item_id,caption,status,publish_status,scheduled_at,video_url"',
    );
    expect(source).not.toContain('.from("generation_items")\n          .select("*")');
    expect(source).not.toContain('.from("posts")\n          .select("*")');
  });
});

describe("campaign library item actions", () => {
  it("documents the markLibraryItemUnfit action contract", () => {
    const source = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");

    expect(source).toContain('case "markLibraryItemUnfit"');
    expect(source).toContain("buildLibraryUnfitUpdate");
    expect(source).toContain('.eq("library_item_id", libraryItemId)');
    expect(source).toContain('.neq("status", "posted")');
  });

  it("regenerate skips every non-posted post linked through generation or library item ids", () => {
    const source = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");

    expect(source).toContain('case "regenerate"');
    expect(source).toContain("skippedGenerationPosts");
    expect(source).toContain('.eq("generation_item_id", itemId)');
    expect(source).toContain("skippedLibraryPosts");
    expect(source).toContain('.eq("library_item_id", item.data.library_item_id)');
    expect(source).toContain('.neq("status", "posted")');
    expect(source).toContain("source_candidate_uses");
  });
});
