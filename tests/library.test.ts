import { describe, expect, it } from "vitest";
import {
  buildLibraryFinalizeUpdate,
  buildLibrarySlotRows,
  buildLyricBlocksFromTranscript,
  normalizeAudioClipRequest,
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
          { source: "stock", provider: "pexels", externalId: "123", url: "https://cdn/a.mp4" },
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
        { source: "stock", provider: "pexels", externalId: "123", url: "https://cdn/a.mp4" },
        { source: "seedance", prompt: "neon stage" },
      ],
      provenance: [
        {
          source_type: "stock",
          provider: "pexels",
          external_id: "123",
          origin_url: "https://cdn/a.mp4",
        },
        {
          source_type: "seedance",
          provider: "seedance",
          external_id: null,
          origin_url: null,
        },
      ],
      perceptual_hash: "ff00aa",
      default_caption: "sound on. neon stage",
      default_hashtags: ["#music", "#edit"],
    });
  });
});
