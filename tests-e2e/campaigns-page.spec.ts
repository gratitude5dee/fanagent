import { expect, test, type Page } from "@playwright/test";
import type { CampaignBatch, CampaignItem, CampaignPost } from "../src/lib/campaigns/api";

type ActionBody = Record<string, unknown>;

const templates = [
  {
    id: "template-1",
    title: "Saved hook",
    status: "saved",
    audio_clip_id: "clip-1",
    trimmed_audio_asset_id: "asset-1",
    total_duration_ms: 30_000,
    selection_duration_ms: 30_000,
    word_count: 8,
    cut_marker_count: 2,
    updated_at: "2026-05-20T00:00:00.000Z",
  },
];

async function mockCampaigns(page: Page, calls: ActionBody[]) {
  const state: {
    batches: CampaignBatch[];
    items: CampaignItem[];
    posts: CampaignPost[];
  } = {
    batches: [
      {
        id: "batch-active",
        account_id: "account-1",
        source_mode: "stock",
        status: "active",
        post_count: 2,
        cadence_minutes: 60,
        paused_at: null,
        completed_at: null,
        created_at: "2026-05-20T00:00:00.000Z",
        prompt: "city lights",
        lyric_template_id: "template-1",
      },
      {
        id: "batch-paused",
        account_id: "account-1",
        source_mode: "seedance",
        status: "paused",
        post_count: 1,
        cadence_minutes: 120,
        paused_at: "2026-05-20T01:00:00.000Z",
        completed_at: null,
        created_at: "2026-05-19T00:00:00.000Z",
        prompt: "studio cut",
        lyric_template_id: null,
      },
    ],
    items: [
      {
        id: "item-failed",
        account_id: "account-1",
        batch_id: "batch-active",
        item_index: 0,
        library_item_id: null,
        status: "failed",
        scheduled_at: "2026-05-21T00:00:00.000Z",
        provider: "pexels",
        prompt: "city lights",
        segments: [],
        stock_clip_url: null,
        render_provider: "fal_ffmpeg",
        error_message: "LYRIC_TEMPLATE_BLOCKS_MISSING",
        lyric_template_id: "template-1",
        stage_events: [{ stage: "karaoke" }],
      },
      {
        id: "item-paused",
        account_id: "account-1",
        batch_id: "batch-paused",
        item_index: 0,
        library_item_id: null,
        status: "pending",
        scheduled_at: "2026-05-22T00:00:00.000Z",
        provider: "seedance",
        prompt: "studio cut",
        segments: [],
        stock_clip_url: null,
        render_provider: null,
        error_message: null,
        lyric_template_id: null,
        stage_events: [],
      },
    ],
    posts: [
      {
        id: "post-1",
        batch_id: "batch-active",
        generation_item_id: "item-failed",
        library_item_id: null,
        caption: "caption",
        status: "queued",
        publish_status: null,
        scheduled_at: "2026-05-21T00:00:00.000Z",
        video_url: null,
      },
    ],
  };

  await page.route("**/functions/v1/fanpage-campaign", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as ActionBody;
    calls.push(body);
    if (body.action === "pause") {
      state.batches = state.batches.map((batch) =>
        batch.id === body.batchId
          ? { ...batch, status: "paused", paused_at: "2026-05-20T02:00:00.000Z" }
          : batch,
      );
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (body.action === "resume") {
      state.batches = state.batches.map((batch) =>
        batch.id === body.batchId ? { ...batch, status: "active", paused_at: null } : batch,
      );
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (body.action === "cancel") {
      state.batches = state.batches.map((batch) =>
        batch.id === body.batchId ? { ...batch, status: "failed" } : batch,
      );
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (body.action === "regenerate") {
      state.items = state.items.map((item) =>
        item.id === body.itemId ? { ...item, status: "pending", error_message: null } : item,
      );
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({
      json: {
        account: { id: "account-1", handle: "@demo", tiktok_display_name: "Demo" },
        ...state,
        lyricTemplates: templates,
      },
    });
  });
}

test.describe("campaigns page", () => {
  test("lists, filters, and acts on campaigns", async ({ page }) => {
    const calls: ActionBody[] = [];
    await mockCampaigns(page, calls);
    await page.goto("/campaigns");

    await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
    await expect(page.getByText("city lights")).toBeVisible();
    await expect(page.getByText("studio cut")).toBeVisible();

    await page.getByLabel("Status").selectOption("paused");
    await expect(page.getByText("studio cut")).toBeVisible();
    await expect(page.getByText("city lights")).toHaveCount(0);

    await page.getByLabel("Status").selectOption("all");
    await page.getByRole("button", { name: "Pause" }).first().click();
    await expect.poll(() => calls.some((body) => body.action === "pause")).toBe(true);
  });

  test("opens detail, scopes the queue, and retries failed renders", async ({ page }) => {
    const calls: ActionBody[] = [];
    await mockCampaigns(page, calls);
    await page.goto("/campaigns");

    await page.getByRole("link", { name: /stock city lights/ }).click();
    await expect(page).toHaveURL(/\/campaigns\/batch-active$/);
    await expect(page.getByRole("heading", { name: "Campaign detail" })).toBeVisible();
    await expect(page.getByText("item-paused")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry render" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Open in Lyrics" })).toHaveAttribute(
      "href",
      "/lyrics/template-1",
    );

    await page.getByRole("button", { name: "Retry render" }).click();
    await expect
      .poll(() =>
        calls.some((body) => body.action === "regenerate" && body.itemId === "item-failed"),
      )
      .toBe(true);
    await expect(page.getByText("pending")).toBeVisible();
  });
});
