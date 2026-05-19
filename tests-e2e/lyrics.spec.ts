import { test, expect } from "@playwright/test";
import {
  adminClient,
  cleanupAccount,
  hasDatabaseCredentials,
  seedAudioClip,
  seedPrimaryAccount,
} from "./helpers";

test.describe("lyrics e2e", () => {
  test.skip(
    !hasDatabaseCredentials,
    "Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY to run DB-backed e2e tests.",
  );

  test("opens the lyrics template review flow after an uploaded clip exists", async ({ page }) => {
    const client = adminClient();
    const accountId = await seedPrimaryAccount(client);

    try {
      const audioClipId = await seedAudioClip(accountId, client);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Fanpage Autopilot" })).toBeVisible();
      await page.getByRole("tab", { name: /Lyrics/i }).click();
      await expect(page.getByText(/Lyric review/i)).toBeVisible();

      const { data, error } = await client
        .from("audio_clips")
        .select("id,transcription_status")
        .eq("id", audioClipId)
        .single();
      if (error) throw error;
      expect(data.transcription_status).toBe("ready");
    } finally {
      await cleanupAccount(accountId, client);
    }
  });
});
