import { test, expect } from "@playwright/test";
import {
  adminClient,
  cleanupAccount,
  createSineWavBuffer,
  hasProviderFlowCredentials,
  openAutopilot,
  seedPrimaryAccount,
  waitForAudioClip,
  waitForLibraryItems,
} from "./helpers";

test.describe("campaign e2e", () => {
  test.skip(
    !hasProviderFlowCredentials,
    "Set E2E_RUN_PROVIDER_FLOW=1 plus Supabase/service/provider credentials to run generation e2e.",
  );

  test("submits quantity=2 stock campaign and waits for ready library rows with provenance", async ({
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
          name: "e2e-campaign.wav",
          mimeType: "audio/wav",
          buffer: createSineWavBuffer(31),
        });
      await page.getByRole("button", { name: /Use this clip/i }).click({ timeout: 60_000 });
      await expect(page.getByText(/Trimmed clip ready/i)).toBeVisible();
      const clip = await waitForAudioClip(accountId, sinceIso, client);

      await page.getByLabel(/Posts to queue/i).fill("2");
      await page.getByLabel(/Source/i).selectOption("stock");
      await page.getByLabel(/Theme \/ visual prompt/i).fill("night-drive city lights");
      await page.getByRole("button", { name: /Generate Library/i }).click();
      await expect(page.getByText(/Campaign launch complete/i)).toBeVisible({ timeout: 30_000 });

      const items = await waitForLibraryItems(String(clip.id), 2, client);
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.thumbnail_url).toBeTruthy();
        expect(Array.isArray(item.provenance)).toBe(true);
        expect((item.provenance as unknown[]).length).toBeGreaterThan(0);
      }
    } finally {
      await cleanupAccount(accountId, client);
    }
  });
});
