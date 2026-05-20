import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDefaultManualSlotValues,
  buildManualSlotsRule,
  calendarEventForPost,
  buildTikTokPrivacySettings,
  creatorPrivacyOptions,
  eventClass,
  filterCalendarLibraryItems,
  filterCalendarPosts,
  isPastScheduleDrop,
  isPostReadOnly,
  isCreatorCommentDisabled,
  isPrivacyLevelAvailable,
  localDateFromInputValue,
  needsTikTokConnection,
  provenanceSummary,
  publishStatusLabel,
  statusTone,
  tiktokPostUrl,
  type CalendarPost,
} from "../src/lib/calendar/posts";

const basePost: CalendarPost = {
  id: "post-1",
  account_id: "account-1",
  caption: "sound on",
  hashtags: ["#music"],
  scheduled_at: "2026-05-20T10:00:00.000Z",
  status: "pending",
  publish_status: "ready",
  video_url: "https://cdn.example.com/final.mp4",
  library_item_id: "library-1",
  tiktok_privacy_level: "SELF_ONLY",
  tiktok_disable_duet: true,
  tiktok_disable_stitch: true,
  tiktok_disable_comment: false,
  tiktok_is_aigc: true,
  tiktok_brand_content: false,
  tiktok_brand_organic: false,
  tiktok_post_id: null,
  posted_at: null,
};

describe("calendar post UI helpers", () => {
  it("marks blocked publish events with the blocked calendar class and warning tone", () => {
    const post = { ...basePost, publish_status: "blocked_account_not_connected" };

    expect(eventClass(post)).toBe("event-blocked");
    expect(statusTone(post)).toBe("warn");
    expect(needsTikTokConnection(post)).toBe(true);
  });

  it("keeps posted events visible but not draggable", () => {
    expect(calendarEventForPost({ ...basePost, status: "posted" })).toMatchObject({
      id: "post-1",
      title: "sound on",
      start: "2026-05-20T10:00:00.000Z",
      editable: false,
    });
    expect(isPostReadOnly({ ...basePost, status: "posted" })).toBe(true);
    expect(isPostReadOnly(basePost)).toBe(false);
  });

  it("rejects calendar drop targets in the past", () => {
    const now = new Date("2026-05-20T10:00:00.000Z");

    expect(isPastScheduleDrop(new Date("2026-05-20T09:59:59.999Z"), now)).toBe(true);
    expect(isPastScheduleDrop(new Date("2026-05-20T10:00:00.000Z"), now)).toBe(false);
  });

  it("builds editable manual bulk schedule slots from local inputs", () => {
    const start = "2026-05-20T10:00";
    const values = buildDefaultManualSlotValues(3, start, 30);

    expect(values).toHaveLength(3);
    expect(new Date(values[1]).getTime() - new Date(values[0]).getTime()).toBe(30 * 60_000);
    expect(buildManualSlotsRule(values)).toEqual({
      type: "manual_slots",
      slots: values.map((value) => ({ scheduledAt: new Date(value).toISOString() })),
    });
    expect(() => buildManualSlotsRule(["not-a-date"])).toThrow(
      "Manual slot 1 must be a valid date and time.",
    );
  });

  it("keeps daily-window rules anchored to the local date field", () => {
    expect(localDateFromInputValue("2026-05-20T00:30")).toBe("2026-05-20");
    expect(() => localDateFromInputValue("not-a-date")).toThrow(
      "Start date must be a valid local date.",
    );
  });

  it("leaves AIGC defaulting to the scheduling backend for single and bulk library scheduling", () => {
    const bulkSource = readFileSync("src/components/calendar/BulkScheduleDialog.tsx", "utf8");
    const singleSource = readFileSync("src/components/library/SingleScheduleDialog.tsx", "utf8");

    expect(bulkSource).not.toContain("isAigc: true");
    expect(singleSource).not.toContain("isAigc: true");
  });

  it("exposes randomized jitter for bulk cadence and daily-window scheduling", () => {
    const bulkSource = readFileSync("src/components/calendar/BulkScheduleDialog.tsx", "utf8");

    expect(bulkSource).toContain("jitterMinutes");
    expect(bulkSource).toContain("Jitter min");
    expect(bulkSource).toContain("max={240}");
  });

  it("moves calendar controls into the route-free Studio panel", () => {
    const studioPanel = readFileSync("src/components/studio/StudioCalendarPanel.tsx", "utf8");

    expect(studioPanel).toContain("CALENDAR_VIEWS");
    expect(studioPanel).toContain("filterCalendarPosts");
    expect(studioPanel).toContain("FanAgentCalendar");
    expect(studioPanel).not.toContain("useNavigate");
  });

  it("formats publish statuses for the post review sheet", () => {
    expect(publishStatusLabel("blocked_missing_privacy")).toBe("blocked missing privacy");
    expect(publishStatusLabel("regenerated")).toBe("regenerated");
    expect(publishStatusLabel(null)).toBe("not sent");
  });

  it("summarizes provenance from library provenance and segment data", () => {
    expect(
      provenanceSummary({
        id: "library-1",
        audio_clip_id: "clip-1",
        library_index: 0,
        duration_sec: 30,
        status: "ready",
        provenance: [{ provider: "pexels", externalId: "123" }],
        segments: [{ source: "seedance" }, { provider: "pixabay", external_id: "abc" }],
      }),
    ).toBe("pexels:123 + seedance + pixabay:abc");
  });

  it("uses TikTok creator info to constrain privacy options", () => {
    const creatorInfo = {
      privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE", "NOT_REAL"],
    };

    expect(creatorPrivacyOptions(creatorInfo)).toEqual(["SELF_ONLY", "PUBLIC_TO_EVERYONE"]);
    expect(isPrivacyLevelAvailable("SELF_ONLY", creatorInfo)).toBe(true);
    expect(isPrivacyLevelAvailable("MUTUAL_FOLLOW_FRIENDS", creatorInfo)).toBe(false);
    expect(isPrivacyLevelAvailable("MUTUAL_FOLLOW_FRIENDS", null)).toBe(true);
  });

  it("locks comment controls when TikTok creator info disables comments", () => {
    expect(isCreatorCommentDisabled({ comment_disabled: true })).toBe(true);
    expect(isCreatorCommentDisabled({ comment_disabled: false })).toBe(false);
    expect(isCreatorCommentDisabled(null)).toBe(false);
  });

  it("builds the privacy_settings payload persisted by post review saves", () => {
    expect(
      buildTikTokPrivacySettings({
        privacyLevel: "SELF_ONLY",
        disableDuet: true,
        disableStitch: false,
        disableComment: true,
        isAigc: true,
        brandContentToggle: false,
        brandOrganicToggle: true,
      }),
    ).toEqual({
      privacy_level: "SELF_ONLY",
      disable_duet: true,
      disable_stitch: false,
      disable_comment: true,
      is_aigc: true,
      brand_content_toggle: false,
      brand_organic_toggle: true,
    });
  });

  it("builds a live TikTok post URL only when post id and handle are available", () => {
    expect(tiktokPostUrl({ tiktok_post_id: "7350000000000000001" }, { handle: "@artist" })).toBe(
      "https://www.tiktok.com/@artist/video/7350000000000000001",
    );
    expect(tiktokPostUrl({ tiktok_post_id: "7350000000000000001" }, { handle: null })).toBeNull();
    expect(tiktokPostUrl({ tiktok_post_id: null }, { handle: "@artist" })).toBeNull();
  });

  it("filters calendar posts by account, audio clip, and blocked status", () => {
    const posts: CalendarPost[] = [
      basePost,
      {
        ...basePost,
        id: "post-2",
        account_id: "account-2",
        library_item_id: "library-2",
        status: "pending",
        publish_status: "blocked_account_not_connected",
      },
      {
        ...basePost,
        id: "post-3",
        account_id: "account-1",
        library_item_id: "library-3",
        status: "posted",
        publish_status: "publish_complete",
      },
    ];
    const previews = [
      {
        id: "library-1",
        audio_clip_id: "clip-1",
        library_index: 0,
        duration_sec: 30,
        status: "scheduled",
        segments: [],
        provenance: [],
      },
      {
        id: "library-2",
        audio_clip_id: "clip-2",
        library_index: 1,
        duration_sec: 30,
        status: "scheduled",
        segments: [],
        provenance: [],
      },
      {
        id: "library-3",
        audio_clip_id: "clip-1",
        library_index: 2,
        duration_sec: 30,
        status: "posted",
        segments: [],
        provenance: [],
      },
    ];

    expect(
      filterCalendarPosts(posts, previews, {
        accountId: "account-1",
        audioClipId: "clip-1",
        status: "all",
      }).map((post) => post.id),
    ).toEqual(["post-1", "post-3"]);

    expect(
      filterCalendarPosts(posts, previews, {
        accountId: "",
        audioClipId: "",
        status: "blocked",
      }).map((post) => post.id),
    ).toEqual(["post-2"]);
  });

  it("filters ready library side-panel items by the active account and audio filters", () => {
    const items = [
      { id: "library-1", account_id: "account-1", audio_clip_id: "clip-1" },
      { id: "library-2", account_id: "account-1", audio_clip_id: "clip-2" },
      { id: "library-3", account_id: "account-2", audio_clip_id: "clip-1" },
    ];

    expect(
      filterCalendarLibraryItems(items, {
        accountId: "account-1",
        audioClipId: "clip-1",
      }).map((item) => item.id),
    ).toEqual(["library-1"]);

    expect(
      filterCalendarLibraryItems(items, {
        accountId: "",
        audioClipId: "clip-1",
      }).map((item) => item.id),
    ).toEqual(["library-1", "library-3"]);
  });
});
