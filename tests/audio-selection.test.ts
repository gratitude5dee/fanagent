import { describe, expect, it } from "vitest";
import {
  clampFixedDurationRegion,
  clipSelectionMatchesDuration,
  isSupportedAudioUpload,
  MAX_AUDIO_UPLOAD_BYTES,
  validateAudioUpload,
} from "../src/lib/audio/selection";

describe("audio upload validation", () => {
  it("accepts the spec-supported audio formats by mime type or extension", () => {
    expect(isSupportedAudioUpload({ name: "hook.mp3", type: "audio/mpeg" })).toBe(true);
    expect(isSupportedAudioUpload({ name: "hook.wav", type: "audio/wav" })).toBe(true);
    expect(isSupportedAudioUpload({ name: "hook.m4a", type: "" })).toBe(true);
    expect(isSupportedAudioUpload({ name: "hook.aac", type: "" })).toBe(true);
    expect(isSupportedAudioUpload({ name: "hook.flac", type: "" })).toBe(true);
  });

  it("rejects unsupported and oversized uploads with user-facing errors", () => {
    expect(() => validateAudioUpload({ name: "clip.mov", type: "video/quicktime" })).toThrow(
      "Use an MP3, WAV, M4A, AAC, or FLAC audio file.",
    );
    expect(() =>
      validateAudioUpload({
        name: "clip.mp3",
        type: "audio/mpeg",
        size: MAX_AUDIO_UPLOAD_BYTES + 1,
      }),
    ).toThrow("Audio uploads are limited to 50 MB.");
  });
});

describe("audio trim selection duration", () => {
  it("keeps the selected region fixed to the requested campaign duration", () => {
    expect(
      clampFixedDurationRegion({
        audioDurationSec: 180,
        startSec: 42.1234,
        targetDurationSec: 30,
      }),
    ).toEqual({ startSec: 42.123, endSec: 72.123 });
  });

  it("clamps the fixed-duration region at the end of the source audio", () => {
    expect(
      clampFixedDurationRegion({
        audioDurationSec: 60,
        startSec: 50,
        targetDurationSec: 30,
      }),
    ).toEqual({ startSec: 30, endSec: 60 });
  });

  it("detects mismatched selections before campaign submission", () => {
    expect(clipSelectionMatchesDuration({ startSec: 10, endSec: 40 }, 30)).toBe(true);
    expect(clipSelectionMatchesDuration({ startSec: 10, endSec: 25 }, 30)).toBe(false);
  });
});
