import { test, expect, type Page, type Route } from "@playwright/test";
import { hasDatabaseCredentials } from "./helpers";

type MockState = {
  scheduled: boolean;
};

async function fulfillJson(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

async function mockStudioData(page: Page, state: MockState) {
  const account = {
    id: "account-1",
    platform: "tiktok",
    handle: "studio_artist",
    status: "active",
    tiktok_connected_at: "2026-05-20T10:00:00.000Z",
    tiktok_display_name: "Studio Artist",
    tiktok_creator_info: {
      privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
      comment_disabled: false,
    },
  };
  const libraryItem = {
    id: "library-1",
    account_id: "account-1",
    audio_clip_id: "clip-1",
    batch_id: null,
    generation_item_id: null,
    library_index: 0,
    status: "ready",
    final_asset_id: null,
    thumbnail_url: "https://example.com/thumb.jpg",
    duration_sec: 30,
    segments: [],
    provenance: [],
    perceptual_hash: null,
    reused_flags: {},
    default_caption: "studio calendar caption",
    default_hashtags: ["#studio"],
    metadata: {},
    created_at: "2026-05-20T10:00:00.000Z",
    updated_at: "2026-05-20T10:00:00.000Z",
  };
  const scheduledPost = {
    id: "post-1",
    account_id: "account-1",
    caption: "studio calendar caption",
    hashtags: ["#studio"],
    scheduled_at: "2026-06-04T09:00:00.000Z",
    status: "pending",
    publish_status: "ready",
    video_url: null,
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

  await page.route("**/rest/v1/accounts**", (route) => fulfillJson(route, [account]));
  await page.route("**/rest/v1/generation_batches**", (route) => fulfillJson(route, []));
  await page.route("**/rest/v1/posts**", (route) =>
    fulfillJson(route, state.scheduled ? [scheduledPost] : []),
  );
  await page.route("**/rest/v1/video_library_items**", (route) => {
    const url = route.request().url();
    if (url.includes("id=in")) return fulfillJson(route, [libraryItem]);
    return fulfillJson(route, [libraryItem]);
  });
  await page.route("**/functions/v1/library-schedule", async (route) => {
    state.scheduled = true;
    await fulfillJson(route, { success: true, data: { scheduled: 1 }, error: null });
  });
  await page.route("**/functions/v1/update-post-schedule", (route) =>
    fulfillJson(route, { success: true, data: { post: scheduledPost }, error: null }),
  );
}

test.describe("studio calendar consolidation", () => {
  test.skip(
    !hasDatabaseCredentials,
    "Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY to run Studio calendar e2e.",
  );

  test("schedules a ready library item from Studio calendar and opens post review", async ({
    page,
  }) => {
    const state: MockState = { scheduled: false };
    await mockStudioData(page, state);

    await page.goto("/?mode=studio&view=calendar");
    await expect(page.getByRole("heading", { name: "Ready library" })).toBeVisible();
    const scheduleRequest = page.waitForRequest(/functions\/v1\/library-schedule/);
    await page
      .getByRole("button", { name: /studio calendar caption/i })
      .dragTo(page.locator(".fc-timegrid-slot").nth(20));
    await scheduleRequest;

    await expect(page.getByText(/Library item scheduled/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Post Review" })).toBeVisible();
    await expect(page.getByLabel(/Caption/i)).toHaveValue("studio calendar caption");
  });
});
