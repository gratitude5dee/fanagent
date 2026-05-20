import { test, expect } from "@playwright/test";
import { hasDatabaseCredentials } from "./helpers";

test.describe("consolidated route redirects", () => {
  test.skip(
    !hasDatabaseCredentials,
    "Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY to run e2e redirects.",
  );

  for (const legacyPath of ["/lyrics", "/lyrics/new", "/lyrics/templates/abc", "/calendar"]) {
    test(`${legacyPath} lands on the consolidated home route`, async ({ page }) => {
      await page.goto(legacyPath);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("heading", { name: "FanAgent" })).toBeVisible();
    });
  }
});
