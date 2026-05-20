import { test, expect } from "@playwright/test";
import {
  adminClient,
  cleanupAccount,
  hasDatabaseCredentials,
  seedAudioClip,
  seedPrimaryAccount,
  seedReadyLibraryItem,
} from "./helpers";

test.describe("calendar e2e", () => {
  test.skip(
    !hasDatabaseCredentials,
    "Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY to run DB-backed e2e tests.",
  );

  test("schedules a ready library tile and verifies calendar reschedule persistence", async ({
    page,
  }) => {
    const client = adminClient();
    const accountId = await seedPrimaryAccount(client);

    try {
      const audioClipId = await seedAudioClip(accountId, client);
      const libraryItemId = await seedReadyLibraryItem(accountId, audioClipId, client);

      await page.goto(`/library/${audioClipId}`);
      await expect(page.getByRole("heading", { name: /e2e-audio/i })).toBeVisible();
      await page
        .getByRole("button", { name: /Schedule/i })
        .first()
        .click();
      await page.getByLabel(/Schedule time/i).fill("2026-06-03T17:00");
      await page
        .getByRole("dialog", { name: /Schedule clip/i })
        .getByRole("button", {
          name: /^Schedule$/i,
        })
        .click();

      const { data: scheduled, error: scheduleError } = await client
        .from("posts")
        .select("id,scheduled_at,library_item_id")
        .eq("library_item_id", libraryItemId)
        .single();
      if (scheduleError) throw scheduleError;
      expect(scheduled.scheduled_at).toContain("2026-06-03");

      await page.goto("/?mode=studio&view=calendar");
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByText(/e2e caption/i)).toBeVisible();
      await page.getByText(/e2e caption/i).click();
      await page.getByLabel(/Scheduled/i).fill("2026-06-04T09:00");
      await page.getByRole("button", { name: /Save post/i }).click();

      const { data: rescheduled, error: rescheduleError } = await client
        .from("posts")
        .select("scheduled_at")
        .eq("id", scheduled.id)
        .single();
      if (rescheduleError) throw rescheduleError;
      expect(rescheduled.scheduled_at).toContain("2026-06-04");
    } finally {
      await cleanupAccount(accountId, client);
    }
  });
});
