import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyTikTokPublishError,
  getTikTokPublishBlock,
  nextTikTokRetryDelayMinutes,
  TikTokPublishBlockedError,
} from "../supabase/functions/_shared/tiktok.ts";

describe("TikTok publish blocking", () => {
  it("blocks missing videos before calling TikTok", () => {
    expect(
      getTikTokPublishBlock({
        video_url: null,
        tiktok_privacy_level: "SELF_ONLY",
      }),
    ).toEqual({
      publishStatus: "blocked_missing_video",
      message: "Post is missing a final video URL.",
    });
  });

  it("blocks missing privacy before calling TikTok", () => {
    expect(
      getTikTokPublishBlock({
        video_url: "https://cdn.example.com/final.mp4",
        tiktok_privacy_level: null,
      }),
    ).toEqual({
      publishStatus: "blocked_missing_privacy",
      message: "Choose a TikTok privacy level before publishing.",
    });
  });

  it("classifies creator restrictions as blocked instead of failed", () => {
    const error = new TikTokPublishBlockedError(
      "Selected TikTok privacy level is not available for this creator.",
      "blocked_creator_restriction",
    );

    expect(classifyTikTokPublishError(error)).toEqual({
      kind: "blocked",
      publishStatus: "blocked_creator_restriction",
      message: "Selected TikTok privacy level is not available for this creator.",
    });
  });

  it("wires the cron wrapper to rescan blocked posts every 30 minutes", () => {
    const wrapper = readFileSync("supabase/functions/fanpage-publish-due/index.ts", "utf8");
    const worker = readFileSync("supabase/functions/publish-tiktok-due/index.ts", "utf8");
    const updatedAtMigration = readFileSync(
      "supabase/migrations/20260519143000_fanagent_posts_updated_at.sql",
      "utf8",
    );

    expect(wrapper).toContain("rescanBlockedMinutes: 30");
    expect(wrapper).toContain("unwrapEnvelopeData<PublishWorkerBody>(json)");
    expect(wrapper).toContain("function publishChildTimeoutMs()");
    expect(wrapper).toContain('"FANAGENT_PUBLISH_CHILD_TIMEOUT_MS"');
    expect(wrapper).toContain("new AbortController()");
    expect(wrapper).toContain("signal: controller.signal");
    expect(wrapper).toContain("publish-tiktok-due timed out after");
    expect(wrapper).toContain("clip(text)");
    expect(wrapper).toContain("const message = clip(errorMessage(error))");
    expect(worker).toContain("isBlockedPublishStatus");
    expect(worker).toContain("blockedRescanCutoff");
    expect(worker).toContain("post.updated_at ?? post.scheduled_at");
    expect(updatedAtMigration).toContain("add column if not exists updated_at");
    expect(updatedAtMigration).toContain("create trigger posts_touch_updated_at");
    expect(updatedAtMigration).toContain("execute function public.touch_updated_at()");
  });

  it("uses the spec retry backoff sequence for retry_scheduled publishes", () => {
    expect(
      [null, 0, 1, 2, 3, 4, 5, 6, 9].map((retryCount) => nextTikTokRetryDelayMinutes(retryCount)),
    ).toEqual([5, 5, 10, 20, 40, 80, 160, 240, 240]);
  });

  it("wires publish retry backoff through the shared helper", () => {
    const worker = readFileSync("supabase/functions/publish-tiktok-due/index.ts", "utf8");

    expect(worker).toContain("nextTikTokRetryDelayMinutes(post.retry_count ?? 0)");
    expect(worker).toContain('publish_status: "retry_scheduled"');
  });

  it("does not publish render or review blocked draft posts during blocked rescans", () => {
    const worker = readFileSync("supabase/functions/publish-tiktok-due/index.ts", "utf8");

    expect(worker).toContain('post.publish_status === "blocked_render_not_ready"');
    expect(worker).toContain('post.publish_status === "blocked_review_required"');
    expect(worker).toContain("return false;");
  });

  it("returns publish result objects with publish ids and explicit error fields", () => {
    const worker = readFileSync("supabase/functions/publish-tiktok-due/index.ts", "utf8");
    const wrapper = readFileSync("supabase/functions/fanpage-publish-due/index.ts", "utf8");

    expect(worker).toContain("publishId: post.tiktok_publish_id");
    expect(worker).toContain("error: null");
    expect(worker).toContain("errorDetail: null");
    expect(wrapper).toContain("tiktok_publish_id: (r.publishId as string | undefined) ?? null");
    expect(wrapper).toContain("raw_response: r");
  });

  it("keeps linked library items intact for publish blocks and failures", () => {
    const worker = readFileSync("supabase/functions/publish-tiktok-due/index.ts", "utf8");

    expect(worker).toContain("library_item_id: string | null");
    expect(worker).toContain("async function markLinkedLibraryPosted");
    expect(worker).toContain('.from("video_library_items")');
    expect(worker).toContain("await markLinkedLibraryPosted(post)");
    expect(worker).not.toContain('await markLinkedLibraryPosted(post, "blocked")');
    expect(worker).not.toContain('await markLinkedLibraryPosted(post, "failed")');
  });

  it("keeps publish workers on the GenViral envelope contract", () => {
    const worker = readFileSync("supabase/functions/publish-tiktok-due/index.ts", "utf8");
    const wrapper = readFileSync("supabase/functions/fanpage-publish-due/index.ts", "utf8");

    expect(worker).toContain("import { errorEnvelope, okEnvelope }");
    expect(worker).toContain('import { isAuthorizedCronCall } from "../_shared/workers.ts"');
    expect(worker).toContain('errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405)');
    expect(worker).toContain('errorEnvelope("Unauthorized cron call", "UNAUTHORIZED_CRON", 401)');
    expect(worker).toContain("if (!(await isAuthorizedCronCall(request)))");
    expect(worker).toContain("okEnvelope({ processed: results.length, results })");
    expect(worker).toContain('"PUBLISH_TIKTOK_DUE_FAILED"');
    expect(worker).not.toContain("jsonResponse({ processed: results.length, results })");

    expect(wrapper).toContain("import { errorEnvelope, okEnvelope, unwrapEnvelopeData }");
    expect(wrapper).toContain('errorEnvelope("Unauthorized cron call", "UNAUTHORIZED_CRON", 401)');
    expect(wrapper).toContain('"x-cron-secret": optionalEnv("CRON_SECRET") ?? ""');
    expect(wrapper).toContain("okEnvelope({ processed: body.processed ?? 0, results })");
    expect(wrapper).toContain('"PUBLISH_WORKER_FAILED"');
    expect(wrapper).not.toContain("jsonResponse({ processed: body.processed");
  });
});
