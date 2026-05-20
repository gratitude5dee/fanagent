import { test, expect } from "@playwright/test";
import {
  adminClient,
  cleanupAccount,
  hasDatabaseCredentials,
  seedAudioClip,
  seedPrimaryAccount,
  seedReadyLibraryItem,
} from "./helpers";

test.describe("post review e2e", () => {
  test.skip(
    !hasDatabaseCredentials,
    "Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY to run DB-backed e2e tests.",
  );

  test("opens post review, edits caption and privacy, and persists the post row", async ({
    page,
  }) => {
    const client = adminClient();
    const accountId = await seedPrimaryAccount(client);

    try {
      const audioClipId = await seedAudioClip(accountId, client);
      const libraryItemId = await seedReadyLibraryItem(accountId, audioClipId, client);
      const post = await client
        .from("posts")
        .insert({
          account_id: accountId,
          library_item_id: libraryItemId,
          caption: "initial caption",
          hashtags: ["#initial"],
          scheduled_at: "2026-06-03T17:00:00.000Z",
          status: "pending",
          publish_status: "ready",
          tiktok_privacy_level: "SELF_ONLY",
          tiktok_disable_duet: true,
          tiktok_disable_stitch: true,
          tiktok_disable_comment: false,
        })
        .select("id")
        .single();
      if (post.error) throw post.error;

      await page.goto("/?mode=studio&view=calendar");
      await expect(page).toHaveURL(/\/$/);
      await page.getByText(/initial caption/i).click();
      await page.getByLabel(/Caption/i).fill("edited caption");
      await page.getByLabel(/TikTok privacy/i).selectOption("PUBLIC_TO_EVERYONE");
      await page.getByRole("button", { name: /Save post/i }).click();

      const { data, error } = await client
        .from("posts")
        .select("caption,tiktok_privacy_level")
        .eq("id", post.data.id)
        .single();
      if (error) throw error;
      expect(data.caption).toBe("edited caption");
      expect(data.tiktok_privacy_level).toBe("PUBLIC_TO_EVERYONE");
    } finally {
      await cleanupAccount(accountId, client);
    }
  });
});
