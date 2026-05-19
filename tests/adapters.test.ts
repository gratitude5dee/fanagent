import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildSportsSearchQuery,
  ownerAssetUrlForVideo,
  parseAllowedChannels as parseSportsAllowedChannels,
  parseYouTubeDurationSeconds,
  sportsEditAdapter,
  youtubeVideoToCandidate,
} from "../supabase/functions/_shared/sources/sports_edit.ts";
import {
  parseAllowedChannels as parseStreamerAllowedChannels,
  twitchMp4UrlFromThumbnail,
  twitchClipToCandidate,
} from "../supabase/functions/_shared/sources/streamer_clip.ts";
import { cacheStockClipWithMetadata } from "../supabase/functions/_shared/sources/stock.ts";

describe("gated source adapters", () => {
  it("parses sports adapter allowlists and builds rights-scoped queries", () => {
    expect(parseSportsAllowedChannels("UCabc, @club-owned , owner-channel")).toEqual([
      "UCabc",
      "@club-owned",
      "owner-channel",
    ]);
    expect(
      buildSportsSearchQuery("fast cuts", {
        league: "NBA",
        team: "Lakers",
      }),
    ).toBe("fast cuts NBA Lakers highlights vertical");
  });

  it("normalizes official YouTube metadata into source candidates", () => {
    const candidate = youtubeVideoToCandidate({
      video: {
        id: "video-1",
        snippet: {
          title: "Lakers highlights #shorts",
          channelId: "UCowned",
          channelTitle: "Owned Sports",
          publishedAt: "2026-05-01T00:00:00Z",
          thumbnails: {
            high: { url: "https://img.youtube.com/vi/video-1/hqdefault.jpg" },
          },
        },
        contentDetails: {
          duration: "PT47S",
          licensedContent: true,
        },
        status: {
          embeddable: true,
          license: "youtube",
          privacyStatus: "public",
        },
      },
      requestedChannel: "UCowned",
      ownerAssetUrl: "https://assets.example.com/video-1.mp4",
    });

    expect(parseYouTubeDurationSeconds("PT1M05S")).toBe(65);
    expect(candidate).toMatchObject({
      source_type: "sports_edit",
      provider: "youtube",
      external_id: "video-1",
      duration_seconds: 47,
      is_portrait: true,
      license: "youtube_owner_provided",
      rights_holder: "Owned Sports",
      cached_url: "https://assets.example.com/video-1.mp4",
      metadata: {
        owner_asset_url: "https://assets.example.com/video-1.mp4",
      },
    });
    expect(candidate.attribution).toContain("Owned Sports");
  });

  it("requires owner-provided MP4 URLs for sports edit render caching", async () => {
    expect(
      ownerAssetUrlForVideo("video-1", {
        ownerAssetUrls: { "video-1": "https://assets.example.com/video-1.mp4" },
      }),
    ).toBe("https://assets.example.com/video-1.mp4");

    await expect(
      sportsEditAdapter.cache({
        source_type: "sports_edit",
        provider: "youtube",
        external_id: "video-1",
        origin_url: "https://www.youtube.com/watch?v=video-1",
        duration_seconds: 15,
        is_portrait: true,
        license: "youtube_owner_provided",
        attribution: "Owned Sports - https://www.youtube.com/watch?v=video-1",
      }),
    ).rejects.toThrow(/owner-provided MP4/);

    await expect(
      sportsEditAdapter.cache({
        source_type: "sports_edit",
        provider: "youtube",
        external_id: "video-1",
        origin_url: "https://www.youtube.com/watch?v=video-1",
        cached_url: "https://assets.example.com/video-1.mp4",
        duration_seconds: 15,
        is_portrait: true,
        license: "youtube_owner_provided",
        attribution: "Owned Sports - https://www.youtube.com/watch?v=video-1",
      }),
    ).resolves.toEqual({
      url: "https://assets.example.com/video-1.mp4",
      storage_path: undefined,
    });
  });

  it("normalizes Twitch Helix clips with creator attribution", () => {
    expect(parseStreamerAllowedChannels("ninja, pokimane")).toEqual(["ninja", "pokimane"]);

    const candidate = twitchClipToCandidate({
      clip: {
        id: "clip-1",
        url: "https://clips.twitch.tv/clip-1",
        embed_url: "https://clips.twitch.tv/embed?clip=clip-1",
        broadcaster_name: "Creator",
        broadcaster_id: "123",
        creator_name: "Clipper",
        duration: 29.4,
        thumbnail_url: "https://clips-media-assets2.twitch.tv/clip-1-preview-480x272.jpg",
        title: "big chorus moment",
        created_at: "2026-05-01T00:00:00Z",
      },
      requestedChannel: "creator",
    });

    expect(candidate).toMatchObject({
      source_type: "streamer_clip",
      provider: "twitch",
      external_id: "clip-1",
      duration_seconds: 29.4,
      license: "twitch_creator_rights",
      rights_holder: "Creator",
      metadata: {
        cache_source_url: "https://clips-media-assets2.twitch.tv/clip-1.mp4",
      },
    });
    expect(candidate.attribution).toContain("Creator");
  });

  it("derives the cacheable Twitch MP4 URL from Helix thumbnail URLs", () => {
    expect(
      twitchMp4UrlFromThumbnail(
        "https://clips-media-assets2.twitch.tv/AT-cm%7C123-preview-480x272.jpg",
      ),
    ).toBe("https://clips-media-assets2.twitch.tv/AT-cm%7C123.mp4");
    expect(twitchMp4UrlFromThumbnail("https://example.com/preview-480x272.jpg")).toBeNull();

    const source = readFileSync("supabase/functions/_shared/sources/streamer_clip.ts", "utf8");
    expect(source).toContain('.from("stock-cache")');
    expect(source).toContain('storage_bucket: "stock-cache"');
    expect(source).toContain("cached_url: cachedUrl");
    expect(source).toContain("expires_at: expiresAt");
  });

  it("carries stock cache metadata back to canonical source candidates", async () => {
    await expect(
      cacheStockClipWithMetadata({
        provider: "library",
        externalId: "asset-1",
        url: "https://assets.example.com/asset-1.mp4",
        width: 1080,
        height: 1920,
        durationSec: 15,
        score: 0.8,
      }),
    ).resolves.toEqual({
      url: "https://assets.example.com/asset-1.mp4",
      storage_bucket: null,
      storage_path: null,
      expires_at: null,
    });

    const source = readFileSync("supabase/functions/_shared/sources/stock.ts", "utf8");
    expect(source).toContain("async function persistStockCandidateCache");
    expect(source).toContain('.from("source_candidates")');
    expect(source).toContain("cached_url: cached.url");
    expect(source).toContain("storage_bucket: cached.storage_bucket");
    expect(source).toContain("storage_path: cached.storage_path");
    expect(source).toContain("expires_at: cached.expires_at");
    expect(source).toContain("persistStockCandidateCache(candidate, cached)");
    expect(source).toContain("storage_path: cached.storage_path ?? candidate.storage_path");
  });
});
