import { test, expect, type Page, type Route } from "@playwright/test";
import { createSineWavBuffer, hasDatabaseCredentials } from "./helpers";

type TemplateState = {
  status: string;
  trimmedAudioAssetId: string | null;
  lyricBlocks: Array<{
    id: string;
    label: string;
    startTime: number;
    endTime: number;
    words: Array<{ id: string; text: string; startTime: number; endTime: number }>;
  }>;
  cutMarkers: number[];
};

const templateId = "11111111-1111-4111-8111-111111111111";

function templateRow(state: TemplateState) {
  return {
    id: templateId,
    user_id: "00000000-0000-0000-0000-000000000001",
    title: "inline-template",
    status: state.status,
    source_audio_asset_id: null,
    trimmed_audio_asset_id: state.trimmedAudioAssetId,
    selection_start_ms: 0,
    selection_duration_ms: 15000,
    total_duration_ms: 31000,
    waveform_peaks: [0.1, 0.7, 0.3, 0.8],
    lyric_blocks: state.lyricBlocks,
    cut_markers: state.cutMarkers,
    transcript_meta: {},
    render_defaults: {},
    error_message: null,
    saved_at: state.status === "saved" ? "2026-05-20T10:00:00.000Z" : null,
    archived_at: null,
    created_at: "2026-05-20T10:00:00.000Z",
    updated_at: "2026-05-20T10:00:00.000Z",
  };
}

async function fulfillJson(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

async function mockLyricsBuilder(page: Page, state: TemplateState) {
  await page.route("**/auth/v1/user", (route) =>
    fulfillJson(route, { id: "00000000-0000-0000-0000-000000000001" }),
  );
  await page.route("**/storage/v1/object/audio-uploads/**", (route) =>
    fulfillJson(route, { Key: "audio-uploads/e2e/inline.wav" }),
  );
  await page.route("**/functions/v1/fanpage-campaign", async (route) => {
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action === "diagnostics") {
      await fulfillJson(route, {
        success: true,
        data: {
          env: {},
          buckets: [{ name: "audio-uploads", ok: true }],
          account: {
            id: "account-1",
            platform: "tiktok",
            handle: "artist",
            tiktokConnected: false,
            tiktokCreatorInfo: null,
          },
          queueCounts: {},
          lastWorkerError: null,
          cron: { configured: false, schedule: "manual", detectable: true },
          schema: { errors: [] },
          recentWorkerRuns: [],
          recentFailedItems: [],
        },
        error: null,
      });
      return;
    }
    await fulfillJson(route, {
      success: true,
      data: {
        account: {
          id: "account-1",
          handle: "artist",
          status: "active",
          tiktok_connected_at: null,
          tiktok_display_name: null,
        },
        batches: [],
        items: [],
        posts: [],
        lyricTemplates: state.status === "saved" ? [templateRow(state)] : [],
      },
      error: null,
    });
  });
  await page.route("**/functions/v1/kanvas-lyrics-audio-register", (route) =>
    fulfillJson(route, {
      success: true,
      data: { id: "asset-1", signedUrl: "https://example.com/inline.wav" },
      error: null,
    }),
  );
  await page.route("**/functions/v1/kanvas-lyrics-transcribe", (route) => {
    state.status = "lyrics_ready";
    state.lyricBlocks = [
      {
        id: "block-1",
        label: "Line 1",
        startTime: 0,
        endTime: 2,
        words: [{ id: "word-1", text: "inline", startTime: 0, endTime: 1 }],
      },
    ];
    return fulfillJson(route, {
      success: true,
      data: { template: templateRow(state) },
      error: null,
    });
  });
  await page.route("**/functions/v1/kanvas-lyrics-template", async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string;
      patch?: Record<string, unknown>;
    } | null;
    if (body?.action === "create") {
      state.status = "draft";
      await fulfillJson(route, {
        success: true,
        data: { template: templateRow(state) },
        error: null,
      });
      return;
    }
    if (body?.action === "patch") {
      if (typeof body.patch?.status === "string") state.status = body.patch.status;
      if (typeof body.patch?.trimmed_audio_asset_id === "string") {
        state.trimmedAudioAssetId = body.patch.trimmed_audio_asset_id;
      }
      if (Array.isArray(body.patch?.lyric_blocks)) {
        state.lyricBlocks = body.patch.lyric_blocks as TemplateState["lyricBlocks"];
      }
      if (Array.isArray(body.patch?.cut_markers)) {
        state.cutMarkers = body.patch.cut_markers as number[];
      }
      await fulfillJson(route, {
        success: true,
        data: { template: templateRow(state) },
        error: null,
      });
      return;
    }
    if (body?.action === "finalize") {
      state.status = "saved";
      await fulfillJson(route, {
        success: true,
        data: { template: templateRow(state) },
        error: null,
      });
      return;
    }
    if (body?.action === "list") {
      await fulfillJson(route, {
        success: true,
        data: { templates: state.status === "saved" ? [templateRow(state)] : [] },
        error: null,
      });
      return;
    }
    await fulfillJson(route, {
      success: true,
      data: { template: templateRow(state) },
      error: null,
    });
  });
}

test.describe("inline lyrics template builder", () => {
  test.skip(
    !hasDatabaseCredentials,
    "Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY to run inline lyrics e2e.",
  );

  test("creates and saves a lyric template without leaving home", async ({ page }) => {
    const state: TemplateState = {
      status: "draft",
      trimmedAudioAssetId: null,
      lyricBlocks: [],
      cutMarkers: [],
    };
    await mockLyricsBuilder(page, state);

    await page.goto("/");
    await page.getByRole("tab", { name: /Lyrics/i }).click();
    await page.getByRole("button", { name: /New template/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.locator('input[type="file"]').setInputFiles({
      name: "inline-template.wav",
      mimeType: "audio/wav",
      buffer: createSineWavBuffer(31),
    });
    await page.getByRole("button", { name: /Confirm selection/i }).click({ timeout: 60_000 });
    await page.getByRole("button", { name: /Done/i }).click({ timeout: 30_000 });
    await page.getByRole("button", { name: /SAVE TEMPLATE/i }).click();

    await expect(page.getByLabel(/Lyrics template/i)).toHaveValue(templateId);
    await expect(page).toHaveURL(/\/$/);
  });
});
