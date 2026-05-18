import { describe, expect, it } from "vitest";
import {
  buildBulkScheduleSlots,
  buildScheduledPostRow,
  normalizeTiktokOptions,
  validateReadyLibraryItem,
} from "../supabase/functions/_shared/schedule.ts";

const readyItem = {
  id: "library-1",
  account_id: "account-1",
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

  it("rejects non-ready library items before post creation", () => {
    expect(() => validateReadyLibraryItem({ id: "library-2", status: "failed" })).toThrow(
      /not ready/,
    );
  });

  it("builds a scheduled post insert row from a ready library item", () => {
    expect(
      buildScheduledPostRow({
        item: readyItem,
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
    });
  });
});
