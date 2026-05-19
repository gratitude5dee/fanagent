import { describe, expect, it } from "vitest";
import { contentFingerprint64 } from "../supabase/functions/_shared/hash.ts";
import {
  renderedVideoSignedUrlSeconds,
  renderedVideoStoragePath,
} from "../supabase/functions/_shared/render-storage.ts";

describe("rendered video asset storage", () => {
  it("uses the private renders bucket path required by the library spec", () => {
    expect(renderedVideoStoragePath("account-1", "library-1")).toBe(
      "renders/account-1/library-1.mp4",
    );
  });

  it("uses seven-day signed URLs for finalized render playback", () => {
    expect(renderedVideoSignedUrlSeconds).toBe(60 * 60 * 24 * 7);
  });

  it("derives stable 64-bit content fingerprints for rendered video fallback hashes", async () => {
    await expect(contentFingerprint64(new Uint8Array([1, 2, 3, 4]))).resolves.toMatch(
      /^[0-9a-f]{16}$/,
    );
    await expect(contentFingerprint64(new Uint8Array([1, 2, 3, 4]))).resolves.toBe(
      await contentFingerprint64(new Uint8Array([1, 2, 3, 4])),
    );
    await expect(contentFingerprint64(new Uint8Array([4, 3, 2, 1]))).resolves.not.toBe(
      await contentFingerprint64(new Uint8Array([1, 2, 3, 4])),
    );
  });
});
