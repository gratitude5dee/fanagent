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
    });
    expect(payload.seedanceSettings).toEqual({
      resolution: "1080p",
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
});
