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
const audioClipId = "22222222-2222-4222-8222-222222222222";
const projectAssetId = "33333333-3333-4333-8333-333333333333";

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
    transcript_meta: {
      audio_clip_id: audioClipId,
      project_asset_id: state.trimmedAudioAssetId,
    },
    render_defaults: {
      audio_clip_id: audioClipId,
      project_asset_id: state.trimmedAudioAssetId,
    },
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

function readyLyricBlocks(): TemplateState["lyricBlocks"] {
  return [
    {
      id: "block-1",
      label: "Line 1",
      startTime: 0,
      endTime: 2,
      words: [{ id: "word-1", text: "inline", startTime: 0, endTime: 1 }],
    },
  ];
}

async function mockLyricsBuilder(page: Page, state: TemplateState) {
  let campaignCreatePayload: Record<string, unknown> | null = null;

  await page.route("**/auth/v1/user", (route) =>
    fulfillJson(route, { id: "00000000-0000-0000-0000-000000000001" }),
  );
  await page.route("**/storage/v1/object/audio-uploads/**", (route) =>
    fulfillJson(route, { Key: "audio-uploads/e2e/inline.wav" }),
  );
  await page.route("**/storage/v1/object/sign/audio-uploads/**", (route) =>
    fulfillJson(route, {
      signedURL: "https://example.com/inline.wav",
      signedUrl: "https://example.com/inline.wav",
    }),
  );
  await page.route("**/rest/v1/project_assets**", (route) =>
    fulfillJson(route, {
      storage_bucket: "audio-uploads",
      storage_path: "e2e/inline.wav",
    }),
  );
  await page.route("**/functions/v1/audio-clip-register", (route) =>
    fulfillJson(route, {
      success: true,
      data: {
        audio_clip: {
          id: audioClipId,
          duration_sec: 30,
          file_name: "inline-template.wav",
          transcription_status: "pending",
          selection_start_sec: 0,
          selection_end_sec: 30,
        },
        media: {
          asset_id: "media-asset-1",
          public_url: "https://example.com/inline.wav",
          mime_type: "audio/wav",
          duration_seconds: 30,
        },
      },
      error: null,
    }),
  );
  await page.route("**/functions/v1/audio-clip-transcribe", (route) =>
    fulfillJson(route, {
      success: true,
      data: {
        audio_clip: {
          id: audioClipId,
          duration_sec: 30,
          file_name: "inline-template.wav",
          transcription_status: "ready",
          selection_start_sec: 0,
          selection_end_sec: 30,
        },
        transcript: {
          text: "inline",
          language: "eng",
          words: [{ text: "inline", start: 0, end: 1 }],
          blocks: readyLyricBlocks(),
        },
      },
      error: null,
    }),
  );
  await page.route("**/functions/v1/fanpage-campaign", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown> | null;
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
    if (body?.action === "create") {
      campaignCreatePayload = body;
      await fulfillJson(route, {
        success: true,
        data: {
          batch: { id: "batch-1" },
          items: [],
          video_library_items: [],
          items_total: 14,
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
        lyricTemplates: state.trimmedAudioAssetId ? [templateRow(state)] : [],
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
    if (body?.action === "createFromAudioClip") {
      state.status = "lyrics_ready";
      state.trimmedAudioAssetId = projectAssetId;
      state.lyricBlocks = readyLyricBlocks();
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
        data: { templates: state.trimmedAudioAssetId ? [templateRow(state)] : [] },
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

  return {
    getCampaignCreatePayload: () => campaignCreatePayload,
  };
}

test.describe("inline lyrics template builder", () => {
  test.skip(
    !hasDatabaseCredentials,
    "Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY to run inline lyrics e2e.",
  );

  test("hydrates the Autopilot audio clip into the inline template and launches with it", async ({
    page,
  }) => {
    const state: TemplateState = {
      status: "draft",
      trimmedAudioAssetId: null,
      lyricBlocks: [],
      cutMarkers: [],
    };
    const mocks = await mockLyricsBuilder(page, state);

    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("button", { name: "30s" }).click();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "inline-template.wav",
        mimeType: "audio/wav",
        buffer: createSineWavBuffer(31),
      });
    await page.getByRole("button", { name: /Use this clip/i }).click({ timeout: 60_000 });

    await expect(page.getByText(/Audio clip registered and transcription is ready/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: /SAVE TEMPLATE/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("inline")).toBeVisible();
    await expect(page.getByText(/Drop or click to upload/i)).not.toBeVisible();

    await page.getByRole("button", { name: /SAVE TEMPLATE/i }).click();

    await expect(page.getByLabel(/Lyrics template/i)).toHaveValue(templateId);
    await page.getByLabel(/Posts to queue/i).fill("14");
    await page.getByRole("button", { name: /Generate library/i }).click();
    await expect(page.getByText(/Campaign launch complete/i)).toBeVisible({ timeout: 30_000 });
    expect(mocks.getCampaignCreatePayload()?.lyricTemplateId).toBe(templateId);
    expect(mocks.getCampaignCreatePayload()?.audioClipId).toBe(audioClipId);
    await expect(page).toHaveURL(/\/$/);
  });
});
