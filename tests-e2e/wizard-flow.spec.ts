// Smoke E2E for the opt-in Autopilot wizard wrapper. Skipped unless the
// preview server + Supabase creds are available.

import { expect, test } from "@playwright/test";
import { hasDatabaseCredentials } from "./helpers";

test.describe("Autopilot wizard", () => {
  test.skip(!hasDatabaseCredentials, "Requires Supabase creds for /?wizard=1 page");

  test("renders wizard chrome", async ({ page }) => {
    await page.goto("/?wizard=1");
    await expect(page.getByRole("heading", { name: "Autopilot wizard" })).toBeVisible();
    await expect(page.getByText("Upload audio")).toBeVisible();
  });

  test("category picker renders as a grid of cards", async ({ page }) => {
    await page.goto("/?wizard=1");
    const radiogroup = page.getByRole("radiogroup", { name: "Clip category" });
    await expect(radiogroup).toBeVisible();
  });
});
