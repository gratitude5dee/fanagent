import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeAudioClipRequest } from "../supabase/functions/_shared/library.ts";
import { searchStock } from "../supabase/functions/_shared/sources/stock.ts";
import {
  ensureCreatorAllowsPost,
  fetchPublishStatus,
} from "../supabase/functions/_shared/tiktok.ts";

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(`supabase/functions/__fixtures__/${name}`, "utf8")) as T;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("edge dry-run fixtures", () => {
  it("normalizes the audio clip fixture into the expected 30s row shape", () => {
    const fixture = readFixture<{
      request: Parameters<typeof normalizeAudioClipRequest>[0];
      expectedAudioClip: {
        account_id: string;
        selection_start_sec: number;
        selection_end_sec: number;
        duration_sec: number;
        file_name: string;
        transcription_status: string;
      };
    }>("audio-clip.sample.json");

    const normalized = normalizeAudioClipRequest(fixture.request);

    expect(normalized.accountId).toBe(fixture.expectedAudioClip.account_id);
    expect(normalized.audioMimeType).toBe("audio/wav");
    expect(normalized.audioFileName).toBe(fixture.expectedAudioClip.file_name);
    expect(normalized.clipSelection).toMatchObject({
      startSec: fixture.expectedAudioClip.selection_start_sec,
      endSec: fixture.expectedAudioClip.selection_end_sec,
      durationSec: fixture.expectedAudioClip.duration_sec,
      originalFileName: "night-drive.mp3",
    });
  });

  it("uses the Pexels fixture through a fetch dry-run and keeps portrait duration matches", async () => {
    const fixture = readFixture<unknown>("pexels.sample.json");
    vi.stubGlobal("Deno", {
      env: {
        get: (name: string) => (name === "PEXELS_API_KEY" ? "pexels_fixture_key" : undefined),
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const clips = await searchStock({
      accountId: "account-1",
      query: "night drive",
      settings: {
        providers: ["pexels"],
        portraitOnly: true,
        minDurationSec: 25,
        maxDurationSec: 35,
        perProviderLimit: 3,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining("orientation=portrait"),
      }),
      expect.objectContaining({ headers: { Authorization: "pexels_fixture_key" } }),
    );
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      provider: "pexels",
      externalId: "1234567",
      width: 1080,
      height: 1920,
      durationSec: 29,
    });
  });

  it("uses the TikTok creator-info fixture to enforce creator restrictions", () => {
    const fixture = readFixture<{
      data: Record<string, unknown>;
    }>("tiktok-creator-info.sample.json");

    expect(() =>
      ensureCreatorAllowsPost(fixture.data, {
        video_url: "https://cdn.example.com/final.mp4",
        tiktok_privacy_level: "SELF_ONLY",
        tiktok_disable_duet: true,
        tiktok_disable_stitch: true,
        tiktok_disable_comment: false,
      }),
    ).not.toThrow();

    expect(() =>
      ensureCreatorAllowsPost(fixture.data, {
        video_url: "https://cdn.example.com/final.mp4",
        tiktok_privacy_level: "SELF_ONLY",
        tiktok_disable_duet: false,
        tiktok_disable_stitch: true,
        tiktok_disable_comment: false,
      }),
    ).toThrow(/duet/);
  });

  it("uses the TikTok publish-status fixture through a fetch dry-run", async () => {
    const fixture = readFixture<{
      complete: {
        data: {
          status: string;
          publicaly_available_post_id: string[];
        };
      };
    }>("tiktok-publish-status.sample.json");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fixture.complete), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(fetchPublishStatus("access-token", "publish-id")).resolves.toEqual(
      fixture.complete,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
        }),
        body: JSON.stringify({ publish_id: "publish-id" }),
      }),
    );
  });
});
