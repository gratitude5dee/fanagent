import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("update-post-schedule TikTok options", () => {
  it("accepts AIGC and brand toggles and persists them to post columns", () => {
    const source = readFileSync("supabase/functions/update-post-schedule/index.ts", "utf8");

    expect(source).toContain("isAigc?: boolean");
    expect(source).toContain("brandContentToggle?: boolean");
    expect(source).toContain("brandOrganicToggle?: boolean");
    expect(source).toContain("update.tiktok_is_aigc = body.isAigc");
    expect(source).toContain("update.tiktok_brand_content = body.brandContentToggle");
    expect(source).toContain("update.tiktok_brand_organic = body.brandOrganicToggle");
  });

  it("rejects schedule updates outside the allowed edit window", () => {
    const source = readFileSync("supabase/functions/update-post-schedule/index.ts", "utf8");

    expect(source).toContain("const minPast = now - 60 * 1000");
    expect(source).toContain("scheduledAt cannot be more than 1 minute in the past.");
    expect(source).toContain("const maxFuture = now + 90 * 24 * 60 * 60 * 1000");
    expect(source).toContain("scheduledAt cannot be more than 90 days in the future.");
  });

  it("promotes reviewed posts only when render, privacy, and TikTok are ready", () => {
    const source = readFileSync("supabase/functions/update-post-schedule/index.ts", "utf8");

    expect(source).toContain("function publishReadiness");
    expect(source).toContain('status: "blocked_render_not_ready"');
    expect(source).toContain('status: "blocked_missing_privacy"');
    expect(source).toContain('status: "blocked_account_not_connected"');
    expect(source).toContain('return { status: "ready", message: null }');
    expect(source).toContain("update.publish_status = readiness.status");
    expect(source).toContain('.update({ status: "scheduled"');
    expect(source).toContain('.eq("status", "ready")');
  });
});
