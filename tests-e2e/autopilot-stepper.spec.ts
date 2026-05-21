import { expect, test, type Page } from "@playwright/test";

const templateId = "template-1";

function templateSummary() {
  return {
    id: templateId,
    title: "Saved hook",
    status: "saved",
    audio_clip_id: "clip-1",
    trimmed_audio_asset_id: "asset-1",
    total_duration_ms: 30_000,
    selection_duration_ms: 30_000,
    word_count: 8,
    cut_marker_count: 2,
    updated_at: "2026-05-20T00:00:00.000Z",
  };
}

function diagnostics() {
  return {
    env: {},
    buckets: [{ name: "post-assets", ok: true }],
    account: null,
    queueCounts: {},
    lastWorkerError: null,
    cron: { configured: true, schedule: "* * * * *", detectable: true },
    schema: { errors: [] },
    recentWorkerRuns: [],
    recentFailedItems: [],
  };
}

async function mockAutopilot(page: Page, connected = true) {
  await page.route("**/rest/v1/clip_categories**", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/rest/v1/view_clip_pool_counts**", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/functions/v1/kanvas-lyrics-template", async (route) => {
    await route.fulfill({ json: { templates: [templateSummary()] } });
  });
  await page.route("**/functions/v1/fanpage-campaign", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    if (body.action === "diagnostics") {
      await route.fulfill({ json: diagnostics() });
      return;
    }
    if (body.action === "create") {
      await route.fulfill({ json: { batch: { id: "batch-new" }, items: [{ id: "item-new" }] } });
      return;
    }
    await route.fulfill({
      json: {
        account: {
          id: "account-1",
          handle: "@demo",
          status: "active",
          tiktok_connected_at: connected ? "2026-05-20T00:00:00.000Z" : null,
          tiktok_display_name: "Demo",
        },
        batches: [],
        items: [],
        posts: [],
        lyricTemplates: [templateSummary()],
      },
    });
  });
}

test.describe("autopilot stepper", () => {
  test("redirects / to the routed connect step", async ({ page }) => {
    await mockAutopilot(page);
    await page.goto("/");

    await expect(page).toHaveURL(/\/autopilot\/connect$/);
    await expect(page.getByRole("heading", { name: "1. Connect TikTok" })).toBeVisible();
    await expect(page.getByText("Step 1 of 5")).toBeVisible();
  });

  test("renders one focused step per route", async ({ page }) => {
    await mockAutopilot(page);
    const routes = [
      ["/autopilot/connect", "1. Connect TikTok"],
      [`/autopilot/upload?lyricTemplateId=${templateId}`, "2. Upload audio"],
      [`/autopilot/lyrics?lyricTemplateId=${templateId}`, "3. Lyrics template"],
      [`/autopilot/campaign?lyricTemplateId=${templateId}`, "4. Campaign parameters"],
      [`/autopilot/review?lyricTemplateId=${templateId}`, "5. Review campaign"],
    ] as const;

    for (const [path, heading] of routes) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      for (const [, otherHeading] of routes) {
        if (otherHeading === heading) continue;
        await expect(page.getByRole("heading", { name: otherHeading })).toHaveCount(0);
      }
    }
  });

  test("locks forward steps and announces the locked state", async ({ page }) => {
    await mockAutopilot(page, false);
    await page.goto("/autopilot/connect");

    const upload = page.getByRole("link", { name: /Upload/ });
    await expect(upload).toHaveAttribute("aria-disabled", "true");
    await upload.click({ force: true });
    await expect(page.locator('[aria-live="polite"]')).toContainText(
      "Step locked - finish previous step first",
    );
    await expect(page).toHaveURL(/\/autopilot\/connect$/);
  });

  test("migrates old campaign deep links and launches into campaign detail", async ({ page }) => {
    await mockAutopilot(page);
    await page.goto(`/?mode=autopilot&view=campaign&lyricTemplateId=${templateId}`);

    await expect(page).toHaveURL(`/autopilot/campaign?lyricTemplateId=${templateId}`);
    await expect(page.getByRole("heading", { name: "4. Campaign parameters" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await page.goto(`/autopilot/review?lyricTemplateId=${templateId}`);
    await page.getByRole("button", { name: /Launch campaign/ }).click();
    await expect(page).toHaveURL(/\/campaigns\/batch-new$/);
  });
});
