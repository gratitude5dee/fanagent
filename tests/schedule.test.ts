import { describe, expect, it } from "vitest";
import {
  buildBulkScheduleSlots,
  buildScheduledPostRow,
  inferAigcDefault,
  normalizeTiktokOptions,
  scheduledPostResponse,
  validateReadyLibraryItem,
} from "../supabase/functions/_shared/schedule.ts";

const readyItem = {
  id: "library-1",
  account_id: "account-1",
  audio_clip_id: "clip-1",
  batch_id: "batch-1",
  generation_item_id: "generation-1",
  final_asset_id: "asset-1",
  status: "ready",
  duration_sec: 30,
  default_caption: "sound on",
  default_hashtags: ["#music"],
};

describe("library schedule helpers", () => {
  it("normalizes TikTok options into Direct Post defaults", () => {
    expect(normalizeTiktokOptions({ privacyLevel: "PUBLIC_TO_EVERYONE" })).toEqual({
      privacyLevel: "PUBLIC_TO_EVERYONE",
      disableDuet: true,
      disableStitch: true,
      disableComment: false,
      isAigc: true,
      brandContentToggle: false,
      brandOrganicToggle: false,
    });
  });

  it("infers AIGC defaults from library provenance and segments", () => {
    expect(
      inferAigcDefault({
        ...readyItem,
        provenance: [{ source_type: "stock", provider: "pexels" }],
        segments: [{ source: "stock", provider: "pixabay" }],
      }),
    ).toBe(false);

    expect(
      inferAigcDefault({
        ...readyItem,
        provenance: [{ source_type: "seedance", provider: "seedance" }],
        segments: [{ source: "stock", provider: "pexels" }],
      }),
    ).toBe(true);

    expect(
      inferAigcDefault({
        ...readyItem,
        segments: [{ sourceType: "gmi_seedance", provider: "gmi" }],
      }),
    ).toBe(true);
  });

  it("builds cadence slots from a start time and interval", () => {
    expect(
      buildBulkScheduleSlots(["a", "b", "c"], {
        type: "cadence",
        startAt: "2026-05-20T10:00:00.000Z",
        everyMinutes: 240,
      }),
    ).toEqual([
      { libraryItemId: "a", scheduledAt: "2026-05-20T10:00:00.000Z" },
      { libraryItemId: "b", scheduledAt: "2026-05-20T14:00:00.000Z" },
      { libraryItemId: "c", scheduledAt: "2026-05-20T18:00:00.000Z" },
    ]);
  });

  it("applies deterministic cadence jitter within the configured range", () => {
    const baseStart = Date.parse("2026-05-20T10:00:00.000Z");
    const jittered = buildBulkScheduleSlots(["a", "b", "c"], {
      type: "cadence",
      startAt: "2026-05-20T10:00:00.000Z",
      everyMinutes: 240,
      jitterMinutes: 10,
    });

    expect(
      buildBulkScheduleSlots(["a", "b", "c"], {
        type: "cadence",
        startAt: "2026-05-20T10:00:00.000Z",
        everyMinutes: 240,
        jitterMinutes: 10,
      }),
    ).toEqual(jittered);
    expect(jittered.map((slot) => slot.scheduledAt)).not.toEqual([
      "2026-05-20T10:00:00.000Z",
      "2026-05-20T14:00:00.000Z",
      "2026-05-20T18:00:00.000Z",
    ]);
    jittered.forEach((slot, index) => {
      const baseTime = baseStart + index * 240 * 60_000;
      const scheduledTime = Date.parse(slot.scheduledAt);
      expect(scheduledTime).toBeGreaterThanOrEqual(baseTime);
      expect(scheduledTime).toBeLessThanOrEqual(baseTime + 10 * 60_000);
    });
  });

  it("distributes daily-window slots across days and max-per-day", () => {
    expect(
      buildBulkScheduleSlots(["a", "b", "c", "d", "e"], {
        type: "daily_windows",
        startDate: "2026-05-20",
        windows: [
          { start: "09:00", end: "10:00" },
          { start: "17:00", end: "18:00" },
        ],
        maxPerDay: 4,
        timezone: "UTC",
      }),
    ).toEqual([
      { libraryItemId: "a", scheduledAt: "2026-05-20T09:00:00.000Z" },
      { libraryItemId: "b", scheduledAt: "2026-05-20T10:00:00.000Z" },
      { libraryItemId: "c", scheduledAt: "2026-05-20T17:00:00.000Z" },
      { libraryItemId: "d", scheduledAt: "2026-05-20T18:00:00.000Z" },
      { libraryItemId: "e", scheduledAt: "2026-05-21T09:00:00.000Z" },
    ]);
  });

  it("keeps daily-window jitter inside the configured window", () => {
    const slots = buildBulkScheduleSlots(["a", "b"], {
      type: "daily_windows",
      startDate: "2026-05-20",
      windows: [{ start: "09:00", end: "10:00" }],
      maxPerDay: 2,
      timezone: "UTC",
      jitterMinutes: 20,
    });

    expect(slots).toHaveLength(2);
    expect(Date.parse(slots[0].scheduledAt)).toBeGreaterThanOrEqual(
      Date.parse("2026-05-20T09:00:00.000Z"),
    );
    expect(Date.parse(slots[0].scheduledAt)).toBeLessThanOrEqual(
      Date.parse("2026-05-20T10:00:00.000Z"),
    );
    expect(slots[1].scheduledAt).toBe("2026-05-20T10:00:00.000Z");
  });

  it("resolves daily-window slots in the requested timezone", () => {
    expect(
      buildBulkScheduleSlots(["a", "b"], {
        type: "daily_windows",
        startDate: "2026-05-20",
        windows: [{ start: "09:00", end: "10:00" }],
        maxPerDay: 2,
        timezone: "America/Los_Angeles",
      }),
    ).toEqual([
      { libraryItemId: "a", scheduledAt: "2026-05-20T16:00:00.000Z" },
      { libraryItemId: "b", scheduledAt: "2026-05-20T17:00:00.000Z" },
    ]);
  });

  it("rejects non-ready library items before post creation", () => {
    expect(() => validateReadyLibraryItem({ id: "library-2", status: "failed" })).toThrow(
      /not ready/,
    );
  });

  it("builds a scheduled post insert row from a ready library item", () => {
    expect(
      buildScheduledPostRow({
        item: {
          ...readyItem,
          provenance: [{ source_type: "stock", provider: "pexels" }],
          segments: [{ source: "stock", provider: "pixabay" }],
        },
        asset: { public_url: "https://cdn/final.mp4", mime_type: "video/mp4" },
        scheduledAt: "2026-05-20T10:00:00.000Z",
        tiktokOptions: { privacyLevel: "SELF_ONLY", disableComment: true },
      }),
    ).toMatchObject({
      account_id: "account-1",
      batch_id: "batch-1",
      generation_item_id: "generation-1",
      library_item_id: "library-1",
      final_asset_id: "asset-1",
      video_url: "https://cdn/final.mp4",
      caption: "sound on",
      hashtags: ["#music"],
      scheduled_at: "2026-05-20T10:00:00.000Z",
      status: "pending",
      publish_status: "ready",
      tiktok_privacy_level: "SELF_ONLY",
      tiktok_disable_comment: true,
      tiktok_is_aigc: false,
    });
  });

  it("keeps generated scheduled posts AIGC-labeled by default and allows overrides", () => {
    const generatedItem = {
      ...readyItem,
      provenance: [{ source_type: "seedance", provider: "seedance" }],
    };

    expect(
      buildScheduledPostRow({
        item: generatedItem,
        asset: { public_url: "https://cdn/final.mp4", mime_type: "video/mp4" },
        scheduledAt: "2026-05-20T10:00:00.000Z",
        tiktokOptions: { privacyLevel: "SELF_ONLY" },
      }),
    ).toMatchObject({
      tiktok_is_aigc: true,
      privacy_settings: { is_aigc: true },
    });

    expect(
      buildScheduledPostRow({
        item: generatedItem,
        asset: { public_url: "https://cdn/final.mp4", mime_type: "video/mp4" },
        scheduledAt: "2026-05-20T10:00:00.000Z",
        tiktokOptions: { privacyLevel: "SELF_ONLY", isAigc: false },
      }),
    ).toMatchObject({
      tiktok_is_aigc: false,
      privacy_settings: { is_aigc: false },
    });
  });

  it("carries source attributions into scheduled post metadata", () => {
    const post = buildScheduledPostRow({
      item: {
        ...readyItem,
        provenance: [
          {
            provider: "youtube",
            attribution: "Creator Name - https://youtube.example/watch?v=123",
          },
        ],
        segments: [
          {
            provider: "twitch",
            attribution: "Streamer Name - https://clips.example/abc",
          },
          {
            provider: "youtube",
            attribution: "Creator Name - https://youtube.example/watch?v=123",
          },
        ],
      },
      asset: { public_url: "https://cdn/final.mp4", mime_type: "video/mp4" },
      scheduledAt: "2026-05-20T10:00:00.000Z",
      tiktokOptions: { privacyLevel: "SELF_ONLY" },
    });

    expect(post.metadata).toEqual({
      attributions: [
        "Creator Name - https://youtube.example/watch?v=123",
        "Streamer Name - https://clips.example/abc",
      ],
      audio_clip_id: "clip-1",
      library_item_id: "library-1",
      duration_seconds: 30,
    });
  });

  it("carries the current asset URL into scheduled post responses", () => {
    const post = buildScheduledPostRow({
      item: readyItem,
      asset: {
        public_url:
          "https://zjbiulirzrctfmakqjwk.supabase.co/storage/v1/object/sign/renders/render.mp4?token=fresh",
        mime_type: "video/mp4",
      },
      scheduledAt: "2026-05-20T10:00:00.000Z",
      tiktokOptions: { privacyLevel: "SELF_ONLY" },
    });

    const response = scheduledPostResponse(post, {
      public_url: post.video_url,
      mime_type: "video/mp4",
    });

    expect(response.video_url).toBe(
      "https://zjbiulirzrctfmakqjwk.supabase.co/storage/v1/object/sign/renders/render.mp4?token=fresh",
    );
    expect(response.media).toMatchObject({
      public_url:
        "https://zjbiulirzrctfmakqjwk.supabase.co/storage/v1/object/sign/renders/render.mp4?token=fresh",
      mime_type: "video/mp4",
      duration_seconds: 30,
    });
  });

  it("prefers asset dimensions and duration in scheduled post media responses", () => {
    const post = buildScheduledPostRow({
      item: readyItem,
      asset: { public_url: "https://cdn/final.mp4", mime_type: "video/mp4" },
      scheduledAt: "2026-05-20T10:00:00.000Z",
      tiktokOptions: { privacyLevel: "SELF_ONLY" },
    });

    expect(
      scheduledPostResponse(post, {
        public_url: post.video_url,
        mime_type: "video/mp4",
        duration_seconds: 29.8,
        metadata: { width: 1080, height: 1920 },
      }).media,
    ).toMatchObject({
      duration_seconds: 29.8,
      width: 1080,
      height: 1920,
    });
  });
});
