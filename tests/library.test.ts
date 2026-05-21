import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildLibrarySegmentReplacement,
  buildLibraryFailureUpdate,
  buildLibraryFinalizeUpdate,
  buildLibrarySlotRows,
  buildLibraryUnfitUpdate,
  buildLyricBlocksFromTranscript,
  deriveBatchLibraryStatus,
  normalizeAudioClipRequest,
  segmentTargetDurationSeconds,
} from "../supabase/functions/_shared/library.ts";

describe("audio clip registration helpers", () => {
  it("normalizes a valid uploaded audio clip request", () => {
    const normalized = normalizeAudioClipRequest({
      accountId: "account-1",
      audioBase64: "data:audio/wav;base64,Zm9v",
      audioMimeType: "audio/wav",
      audioFileName: "hook.wav",
      clipSelection: {
        startSec: 12.245,
        endSec: 42.245,
        durationSec: 30,
      },
    });

    expect(normalized.accountId).toBe("account-1");
    expect(normalized.audioBytes.byteLength).toBe(3);
    expect(normalized.audioMimeType).toBe("audio/wav");
    expect(normalized.audioFileName).toBe("hook.wav");
    expect(normalized.clipSelection).toEqual({
      startSec: 12.245,
      endSec: 42.245,
      durationSec: 30,
      originalFileName: "hook.wav",
    });
  });

  it("rejects unsupported audio MIME types and non-standard durations", () => {
    expect(() =>
      normalizeAudioClipRequest({
        accountId: "account-1",
        audioBase64: "Zm9v",
        audioMimeType: "video/mp4",
        clipSelection: { startSec: 0, endSec: 30, durationSec: 30 },
      }),
    ).toThrow(/Unsupported audio MIME type/);

    expect(() =>
      normalizeAudioClipRequest({
        accountId: "account-1",
        audioBase64: "Zm9v",
        audioMimeType: "audio/wav",
        clipSelection: { startSec: 0, endSec: 20, durationSec: 20 },
      }),
    ).toThrow(/durationSec must be one of/);
  });
});

describe("audio clip transcription helpers", () => {
  it("groups transcript words into lyric blocks with millisecond timings", () => {
    const blocks = buildLyricBlocksFromTranscript({
      language: "eng",
      text: "we rise tonight",
      words: [
        { text: "we", start: 0, end: 0.3 },
        { text: "rise", start: 0.35, end: 0.8 },
        { text: "tonight", start: 0.9, end: 1.3 },
      ],
    });

    expect(blocks).toEqual([
      {
        id: "block-1",
        label: "Line 1",
        text: "we rise tonight",
        startMs: 0,
        endMs: 1300,
        words: [
          { id: "word-1", text: "we", startMs: 0, endMs: 300 },
          { id: "word-2", text: "rise", startMs: 350, endMs: 800 },
          { id: "word-3", text: "tonight", startMs: 900, endMs: 1300 },
        ],
      },
    ]);
  });
});

describe("video library item helpers", () => {
  it("builds one not-ready library slot per requested quantity", () => {
    const rows = buildLibrarySlotRows({
      accountId: "account-1",
      audioClipId: "audio-clip-1",
      batchId: "batch-1",
      quantity: 3,
      durationSec: 30,
    });

    expect(rows).toEqual([
      {
        account_id: "account-1",
        audio_clip_id: "audio-clip-1",
        batch_id: "batch-1",
        library_index: 0,
        status: "not_ready",
        duration_sec: 30,
      },
      {
        account_id: "account-1",
        audio_clip_id: "audio-clip-1",
        batch_id: "batch-1",
        library_index: 1,
        status: "not_ready",
        duration_sec: 30,
      },
      {
        account_id: "account-1",
        audio_clip_id: "audio-clip-1",
        batch_id: "batch-1",
        library_index: 2,
        status: "not_ready",
        duration_sec: 30,
      },
    ]);
  });

  it("builds a ready library update from a finalized generation item", () => {
    const update = buildLibraryFinalizeUpdate({
      item: {
        id: "item-1",
        final_asset_id: "asset-1",
        duration_seconds: 30,
        segments: [
          {
            source: "stock",
            sourceType: "stock",
            provider: "pexels",
            externalId: "123",
            url: "https://cdn/a.mp4",
            license: "pexels",
            rightsHolder: "Pexels",
            attribution: "Pexels - https://pexels.example/video/123",
            storagePath: "stock-cache/pexels/123.mp4",
            reused: true,
          },
          { source: "seedance", prompt: "neon stage" },
        ],
        perceptual_hash: null,
        input_payload: {
          prompt_plan: {
            caption: "sound on. neon stage",
            hashtags: ["#music", "#edit"],
          },
        },
      },
      asset: {
        id: "asset-1",
        public_url: "https://cdn/final.mp4",
        metadata: {
          thumbnail_url: "https://cdn/thumb.jpg",
          perceptual_hash: "ff00aa",
        },
      },
    });

    expect(update).toEqual({
      status: "ready",
      final_asset_id: "asset-1",
      thumbnail_url: "https://cdn/thumb.jpg",
      duration_sec: 30,
      segments: [
        {
          source: "stock",
          sourceType: "stock",
          provider: "pexels",
          externalId: "123",
          url: "https://cdn/a.mp4",
          license: "pexels",
          rightsHolder: "Pexels",
          attribution: "Pexels - https://pexels.example/video/123",
          storagePath: "stock-cache/pexels/123.mp4",
          reused: true,
        },
        { source: "seedance", prompt: "neon stage" },
      ],
      provenance: [
        {
          source_type: "stock",
          provider: "pexels",
          external_id: "123",
          origin_url: "https://cdn/a.mp4",
          candidate_id: null,
          license: "pexels",
          rights_holder: "Pexels",
          attribution: "Pexels - https://pexels.example/video/123",
          storage_path: "stock-cache/pexels/123.mp4",
          reused: true,
        },
        {
          source_type: "seedance",
          provider: "seedance",
          external_id: null,
          origin_url: null,
          candidate_id: null,
          license: null,
          rights_holder: null,
          attribution: null,
          storage_path: null,
          reused: false,
        },
      ],
      perceptual_hash: "ff00aa",
      reused_flags: { "0": true },
      default_caption: "sound on. neon stage",
      default_hashtags: ["#music", "#edit"],
      metadata: {},
    });
  });

  it("clears stale failure metadata when a library item becomes ready", () => {
    const update = buildLibraryFinalizeUpdate({
      item: {
        id: "item-1",
        final_asset_id: "asset-1",
        duration_seconds: 15,
        segments: [],
        input_payload: {},
      },
      asset: {
        id: "asset-1",
        public_url: "https://cdn/final.mp4",
        metadata: {},
      },
      libraryMetadata: {
        failed: true,
        failure_error: "old timeout",
        failed_at: "2026-05-19T14:02:08.819Z",
        backfilled_missing_library_slot: true,
      },
    });

    expect(update).toMatchObject({
      status: "ready",
      metadata: { backfilled_missing_library_slot: true },
    });

    const migration = readFileSync(
      "supabase/migrations/20260519143100_fanagent_clear_ready_library_failure_metadata.sql",
      "utf8",
    );
    expect(migration).toContain("status in ('ready', 'scheduled', 'posted')");
    expect(migration).toContain("- 'failed' - 'failure_error' - 'failed_at'");
  });

  it("builds a segment replacement with provenance for re-rendering", () => {
    const replacement = buildLibrarySegmentReplacement({
      segments: [
        {
          source: "stock",
          sourceType: "stock",
          url: "https://cdn/old.mp4",
          provider: "pexels",
          externalId: "old",
          durationSec: 15,
        },
      ],
      segmentIndex: 0,
      cachedUrl: "https://cdn/new.mp4",
      storagePath: "stock-cache/pexels/new.mp4",
      libraryDurationSec: 15,
      toleranceSecondsUsed: 5,
      candidate: {
        id: "candidate-1",
        source_type: "stock",
        provider: "pexels",
        external_id: "new",
        origin_url: "https://origin/new.mp4",
        duration_seconds: 14,
        is_portrait: true,
        license: "pexels",
        rights_holder: "Pexels",
        attribution: "Pexels - https://origin/new.mp4",
      },
    });

    expect(replacement.segments[0]).toMatchObject({
      source: "stock",
      sourceType: "stock",
      url: "https://cdn/new.mp4",
      provider: "pexels",
      externalId: "new",
      candidateId: "candidate-1",
      toleranceSec: 5,
      license: "pexels",
    });
    expect(replacement.provenance[0]).toMatchObject({
      source_type: "stock",
      provider: "pexels",
      external_id: "new",
      candidate_id: "candidate-1",
      attribution: "Pexels - https://origin/new.mp4",
    });
  });

  it("uses segment duration before whole-library duration for replacement tolerance", () => {
    expect(
      segmentTargetDurationSeconds({
        segment: { durationSec: 12 },
        segmentCount: 3,
        libraryDurationSec: 45,
      }),
    ).toBe(12);
    expect(
      segmentTargetDurationSeconds({
        segment: {},
        segmentCount: 3,
        libraryDurationSec: 45,
      }),
    ).toBe(15);
  });

  it("builds a blocked library update when a tile is marked unfit", () => {
    const update = buildLibraryUnfitUpdate({
      metadata: { existing: true },
      reason: "Bad crop",
      now: new Date("2026-05-18T12:00:00.000Z"),
    });

    expect(update).toEqual({
      status: "blocked",
      metadata: {
        existing: true,
        unfit: true,
        unfit_reason: "Bad crop",
        marked_unfit_at: "2026-05-18T12:00:00.000Z",
      },
      updated_at: "2026-05-18T12:00:00.000Z",
    });
  });

  it("builds a failed library update when generation exhausts retries", () => {
    const update = buildLibraryFailureUpdate({
      metadata: { existing: true },
      error: "TOLERANCE_EXCEEDED",
      now: new Date("2026-05-18T12:00:00.000Z"),
    });

    expect(update).toEqual({
      status: "failed",
      metadata: {
        existing: true,
        failed: true,
        failure_error: "TOLERANCE_EXCEEDED",
        failed_at: "2026-05-18T12:00:00.000Z",
      },
      updated_at: "2026-05-18T12:00:00.000Z",
    });
  });

  it("keeps the generation link when a library item fails before finalize", () => {
    const update = buildLibraryFailureUpdate({
      metadata: { existing: true },
      error: "render failed",
      generationItemId: "generation-1",
      now: new Date("2026-05-18T12:00:00.000Z"),
    });

    expect(update).toMatchObject({
      status: "failed",
      generation_item_id: "generation-1",
      metadata: {
        existing: true,
        failed: true,
        failure_error: "render failed",
      },
    });
  });

  it("repairs library and generation links in the regenerate migration", () => {
    const migration = readFileSync(
      "supabase/migrations/20260521145352_fanagent_regenerate_link_repair.sql",
      "utf8",
    );

    expect(migration).toContain("gi.library_item_id = vli.id");
    expect(migration).toContain("vli.generation_item_id = gi.id");
    expect(migration).toContain("idx_video_library_items_generation_item_id");
    expect(migration).toContain("idx_generation_items_library_item_id");
    expect(migration).toContain("idx_video_library_items_failed_regenerate");
  });

  it("backfills library generation ids immediately after batch item creation", () => {
    const source = readFileSync("supabase/functions/create-generation-batch/index.ts", "utf8");

    expect(source).toContain('.from("generation_items").insert(items).select("*")');
    expect(source).toContain('.from("video_library_items")');
    expect(source).toContain("generation_item_id: item.id");
    expect(source).toContain('.eq("id", libraryItemId)');
  });

  it("derives batch library status from ready and failed slot states", () => {
    expect(deriveBatchLibraryStatus([])).toBe("building");
    expect(deriveBatchLibraryStatus(["not_ready", "ready"])).toBe("building");
    expect(deriveBatchLibraryStatus(["ready", "scheduled", "posted"])).toBe("ready");
    expect(deriveBatchLibraryStatus(["failed", "blocked"])).toBe("failed");
    expect(deriveBatchLibraryStatus(["ready", "failed"])).toBe("exhausted");
    expect(deriveBatchLibraryStatus(["ready", "scheduled"], 3)).toBe("building");
    expect(deriveBatchLibraryStatus(["ready", "scheduled", "posted"], 3)).toBe("ready");
  });
});
