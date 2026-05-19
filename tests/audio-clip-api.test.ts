import { describe, expect, it } from "vitest";
import { blobToBase64, buildAudioClipRegisterBody } from "../src/lib/fanagent/audioClipPayload";

describe("FanAgent audio clip API payloads", () => {
  it("encodes the trimmed WAV clip for audio-clip-register", async () => {
    const body = await buildAudioClipRegisterBody({
      accountId: "account-1",
      trimmedAudio: {
        blob: new Blob(["foo"], { type: "audio/wav" }),
        durationSec: 30,
        name: "hook.mp3",
        startSec: 12,
        endSec: 42,
        originalFileName: "hook.mp3",
      },
    });

    expect(body).toEqual({
      accountId: "account-1",
      audioBase64: "Zm9v",
      audioMimeType: "audio/wav",
      audioFileName: "hook.wav",
      clipSelection: {
        startSec: 12,
        endSec: 42,
        durationSec: 30,
        originalFileName: "hook.mp3",
      },
    });
  });

  it("keeps base64 conversion reusable for legacy function contracts", async () => {
    await expect(blobToBase64(new Blob(["bar"]))).resolves.toBe("YmFy");
  });
});
