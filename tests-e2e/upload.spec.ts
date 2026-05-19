import { test, expect } from "@playwright/test";
import {
  adminClient,
  cleanupAccount,
  createSineWavBuffer,
  hasDatabaseCredentials,
  openAutopilot,
  seedPrimaryAccount,
  waitForAudioClip,
} from "./helpers";

test.describe("upload e2e", () => {
  test.skip(
    !hasDatabaseCredentials,
    "Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY to run DB-backed e2e tests.",
  );

  test("uploads a sample WAV, selects 30s, confirms trim, and creates an audio_clip", async ({
    page,
  }) => {
    const client = adminClient();
    const accountId = await seedPrimaryAccount(client);
    const sinceIso = new Date().toISOString();

    try {
      await openAutopilot(page);
      await page.getByRole("button", { name: "30s" }).click();
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "e2e-30s.wav",
          mimeType: "audio/wav",
          buffer: createSineWavBuffer(31),
        });
      await page.getByRole("button", { name: /Use this clip/i }).click({ timeout: 60_000 });
      await expect(page.getByText(/Trimmed clip ready/i)).toBeVisible();

      const clip = await waitForAudioClip(accountId, sinceIso, client);
      expect(clip.duration_sec).toBe(30);
      expect(clip.file_name).toContain("e2e-30s");
    } finally {
      await cleanupAccount(accountId, client);
    }
  });
});
