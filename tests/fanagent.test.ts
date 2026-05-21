import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findGmiVideoUrl } from "../src/lib/fanagent/gmi";
import { createPromptPlan } from "../src/lib/fanagent/prompt";
import { buildSchedule } from "../src/lib/fanagent/schedule";
import {
  buildSourceOptions,
  coerceSelectableSourceMode,
  normalizeSourceMode,
  sourceModeNeedsFal,
  sourceModeNeedsGmi,
} from "../src/lib/fanagent/sourceMode";
import {
  buildDirectPostInitBody,
  createChunkPlan,
  isTikTokPrivacyLevelAllowed,
  parseTikTokStatusResponse,
} from "../src/lib/fanagent/tiktok";
import { extractFrame, isFalIdleTimeout } from "../supabase/functions/_shared/fal.ts";
import {
  buildBatchSettings,
  buildGenerationItemInputPayload,
  collectUsedStockKeys,
  createRegenerationReset,
  createSegmentVisualPlan,
  normalizeClipSelection,
  selectStockCandidate,
} from "../supabase/functions/_shared/generation.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("schedule generation", () => {
  it("builds bounded schedules from a start date and cadence", () => {
    const start = new Date("2026-05-10T12:00:00.000Z");
    const schedule = buildSchedule(start, 3, 30);

    expect(schedule.map((date) => date.toISOString())).toEqual([
      "2026-05-10T12:00:00.000Z",
      "2026-05-10T12:30:00.000Z",
      "2026-05-10T13:00:00.000Z",
    ]);
  });

  it("clamps count and cadence to campaign limits", () => {
    const schedule = buildSchedule(new Date("2026-05-10T12:00:00.000Z"), 999, 1);

    expect(schedule).toHaveLength(250);
    expect(schedule[1].getTime() - schedule[0].getTime()).toBe(5 * 60_000);
  });
});

describe("source mode normalization", () => {
  it("normalizes legacy and invalid source modes", () => {
    expect(normalizeSourceMode("hybrid")).toBe("mixed");
    expect(normalizeSourceMode("seedance")).toBe("seedance");
    expect(normalizeSourceMode("sports_edit")).toBe("sports_edit");
    expect(normalizeSourceMode("streamer_clip")).toBe("streamer_clip");
    expect(normalizeSourceMode("remote_render")).toBe("stock");
  });

  it("classifies provider requirements", () => {
    expect(sourceModeNeedsFal("mixed")).toBe(true);
    expect(sourceModeNeedsFal("stock")).toBe(false);
    expect(sourceModeNeedsGmi("gmi_seedance")).toBe(true);
  });

  it("builds source options from diagnostics and gates adapters on provider credentials", () => {
    const missingGated = buildSourceOptions({
      fal: true,
      gmi: false,
      youtubeApiKey: true,
      sportsAllowed: false,
      twitchClientId: true,
      twitchClientSecret: true,
      streamerAllowed: false,
    });

    expect(missingGated.map((option) => option.value)).toEqual([
      "stock",
      "mixed",
      "seedance",
      "gmi_seedance",
      "sports_edit",
      "streamer_clip",
    ]);
    expect(missingGated.find((option) => option.value === "gmi_seedance")).toMatchObject({
      disabled: true,
      reason: "GMI key missing",
    });
    expect(missingGated.find((option) => option.value === "sports_edit")).toMatchObject({
      disabled: false,
      reason: "YouTube API key missing",
    });
    expect(missingGated.find((option) => option.value === "streamer_clip")).toMatchObject({
      disabled: false,
      reason: "Twitch credentials missing",
    });
    expect(coerceSelectableSourceMode("sports_edit", { youtubeApiKey: true })).toBe("sports_edit");
    expect(coerceSelectableSourceMode("sports_edit", { youtubeApiKey: false })).toBe("stock");
    expect(
      coerceSelectableSourceMode("streamer_clip", {
        twitchClientId: true,
        twitchClientSecret: true,
      }),
    ).toBe("streamer_clip");
    expect(
      coerceSelectableSourceMode("streamer_clip", {
        twitchClientId: true,
        twitchClientSecret: false,
      }),
    ).toBe("stock");

    const allowedGated = buildSourceOptions({
      fal: true,
      gmi: true,
      youtubeApiKey: true,
      sportsAllowed: true,
      twitchClientId: true,
      twitchClientSecret: true,
      streamerAllowed: true,
    });

    expect(allowedGated.map((option) => option.value)).toContain("sports_edit");
    expect(allowedGated.map((option) => option.value)).toContain("streamer_clip");
    expect(allowedGated.find((option) => option.value === "sports_edit")?.disabled).toBe(false);
    expect(allowedGated.find((option) => option.value === "streamer_clip")?.disabled).toBe(false);
    expect(
      coerceSelectableSourceMode("streamer_clip", {
        twitchClientId: true,
        twitchClientSecret: true,
        streamerAllowed: true,
      }),
    ).toBe("streamer_clip");
  });
});

describe("fal helpers", () => {
  it("extracts a frame using the current fal extract-frame schema", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("Deno", {
      env: {
        get: (name: string) => (name === "FAL_KEY" ? "test-fal-key" : undefined),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(
          JSON.stringify({
            images: [{ url: "https://v3.fal.media/files/thumb.jpg" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    await expect(
      extractFrame("https://cdn.example.com/video.mp4", "middle"),
    ).resolves.toMatchObject({ url: "https://v3.fal.media/files/thumb.jpg" });
    expect(requests).toEqual([
      {
        video_url: "https://cdn.example.com/video.mp4",
        frame_type: "middle",
      },
    ]);
  });

  it("detects fal idle timeout errors", () => {
    expect(isFalIdleTimeout(new Error("fal.ai failed [504]: IDLE_TIMEOUT"))).toBe(true);
    expect(isFalIdleTimeout(new Error("quota exceeded"))).toBe(false);
  });
});

describe("prompt generation", () => {
  it("emits SCLCAM-style vertical prompts with safe social-video constraints", () => {
    const plan = createPromptPlan({
      basePrompt: "stage lights and a packed venue",
      index: 0,
      total: 2,
    });

    expect(plan.prompt).toContain("9:16 aspect ratio");
    expect(plan.prompt).toContain("no logos or watermarks");
    expect(plan.videoPrompt.duration_seconds).toBe(15);
    expect(plan.caption).toContain("stage lights");
  });

  it("propagates longer video durations into generation prompts", () => {
    const plan = createPromptPlan({
      basePrompt: "night market performance",
      index: 1,
      total: 4,
      durationSeconds: 90,
    });

    expect(plan.prompt).toContain("90 seconds");
    expect(plan.videoPrompt.duration_seconds).toBe(90);
  });

  it("covers every allowed campaign duration in generation prompts", () => {
    const durations = [15, 30, 45, 60, 75, 90] as const;

    for (const durationSeconds of durations) {
      const plan = createPromptPlan({
        basePrompt: "night market performance",
        index: durationSeconds,
        total: durations.length,
        durationSeconds,
      });

      expect(plan.prompt).toContain(`${durationSeconds} seconds`);
      expect(plan.videoPrompt.duration_seconds).toBe(durationSeconds);
    }
  });
});

describe("visual diversity planning", () => {
  it("prefers unused stock candidates, then marks reuse after inventory is exhausted", () => {
    const candidates = [
      {
        provider: "pexels",
        externalId: "clip-a",
        url: "https://cdn.example.com/a.mp4",
        score: 0.99,
      },
      {
        provider: "pixabay",
        externalId: "clip-b",
        url: "https://cdn.example.com/b.mp4",
        score: 0.9,
      },
    ];
    const used = collectUsedStockKeys([
      {
        segments: [
          {
            source: "stock",
            provider: "pexels",
            externalId: "clip-a",
            url: "https://cdn.example.com/a.mp4",
          },
        ],
      },
    ]);

    const firstPick = selectStockCandidate(candidates, used);
    expect(firstPick).toMatchObject({
      candidate: { externalId: "clip-b" },
      reused: false,
    });

    used.add("pixabay:clip-b");
    used.add("https://cdn.example.com/b.mp4");
    const exhaustedPick = selectStockCandidate(candidates, used);
    expect(exhaustedPick).toMatchObject({
      candidate: { externalId: "clip-a" },
      reused: true,
    });
  });

  it("varies stock queries and Seedance prompts across items with the same base prompt", () => {
    const plans = Array.from({ length: 12 }, (_, index) =>
      createSegmentVisualPlan({
        basePrompt: "stage lights and a packed venue",
        itemIndex: index,
        segmentIndex: 0,
        transcriptContext: "we go higher every night",
      }),
    );

    expect(new Set(plans.map((plan) => plan.query)).size).toBe(plans.length);
    expect(new Set(plans.map((plan) => plan.prompt)).size).toBe(plans.length);
    expect(plans[0].prompt).toContain("post 1, segment 1");
    expect(plans[1].prompt).toContain("post 2, segment 1");
  });

  it("builds a clean regeneration reset for stale visual fields", () => {
    const reset = createRegenerationReset("2026-05-13T12:00:00.000Z");

    expect(reset).toMatchObject({
      status: "pending",
      segments: null,
      stock_clip_url: null,
      final_asset_id: null,
      render_provider: null,
      post_id: null,
      provider_request_id: null,
      duration_tolerance_seconds_used: null,
      perceptual_hash: null,
      error_message: null,
      stage_events: [],
      updated_at: "2026-05-13T12:00:00.000Z",
    });
  });

  it("carries selected audio clip metadata into batch settings and item payloads", () => {
    const clipSelection = normalizeClipSelection(
      {
        startSec: 4.3219,
        endSec: 19.789,
        durationSec: 15.467,
        originalFileName: "hook.wav",
      },
      15,
    );

    const settings = buildBatchSettings({
      stockSettings: { avoidReuseWithinBatch: true },
      seedanceSettings: { resolution: "720p" },
      clipSelection,
    });
    const payload = buildGenerationItemInputPayload({
      sourceMode: "stock",
      promptPlan: { prompt: "vertical edit" },
      audioAssetId: "audio-asset-1",
      durationSeconds: 15,
      stockSettings: { allowReuseWhenExhausted: true },
      seedanceSettings: {},
      publishDefaults: { privacyLevel: "SELF_ONLY" },
      clipSelection,
      audioClipId: "audio-clip-1",
      libraryItemId: "library-item-1",
      durationTolerance: { preferredSeconds: 5, fallbackSeconds: 10 },
    });

    expect(clipSelection).toEqual({
      startSec: 4.322,
      endSec: 19.789,
      durationSec: 15.467,
      originalFileName: "hook.wav",
    });
    expect(settings.clipSelection).toEqual(clipSelection);
    expect(payload.clip_selection).toEqual(clipSelection);
    expect(payload.audio_asset_id).toBe("audio-asset-1");
    expect(payload.audio_clip_id).toBe("audio-clip-1");
    expect(payload.library_item_id).toBe("library-item-1");
    expect(payload.duration_tolerance).toEqual({ preferred_seconds: 5, fallback_seconds: 10 });
  });
});

describe("generation reliability fixes", () => {
  it("keeps browser audio trimming off ffmpeg.wasm core imports", () => {
    const source = readFileSync("src/lib/audio/ffmpeg.ts", "utf8");

    expect(source).not.toContain("@ffmpeg/ffmpeg");
    expect(source).not.toContain("ffmpeg-core.js");
    expect(source).toContain("audio/wav");
  });

  it("classifies fal and Supabase idle timeouts as retryable stitch failures", () => {
    expect(
      isFalIdleTimeout(
        new Error(
          'stitch-segments failed [504]: {"code":"IDLE_TIMEOUT","message":"Request idle timeout limit (150s) reached"}',
        ),
      ),
    ).toBe(true);
  });

  it("persists idle-timeout retry escalation on generation items", () => {
    const workerSource = readFileSync("supabase/functions/fanpage-generate-due/index.ts", "utf8");

    expect(workerSource).toContain("const idleTimeout = isIdleTimeout(err)");
    expect(workerSource).toContain("Math.max(row.max_attempts ?? 3, 5)");
    expect(workerSource).toContain("max_attempts: maxAttempts");
    expect(workerSource).toContain("...(idleTimeout ? { maxAttempts } : {})");
  });

  it("keeps live generation recovery in one database-side RPC", () => {
    const campaignSource = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20260518140500_fanagent_recovery_rpc.sql",
      "utf8",
    );
    const cloudflareRetryMigration = readFileSync(
      "supabase/migrations/20260518143500_fanagent_recover_cloudflare_retry.sql",
      "utf8",
    );
    const cleanupMigration = readFileSync(
      "supabase/migrations/20260518150000_fanagent_cleanup_stale_recovery_metadata.sql",
      "utf8",
    );
    const renderStateRecoveryMigration = readFileSync(
      "supabase/migrations/20260518224500_fanagent_recovery_reset_render_state.sql",
      "utf8",
    );

    expect(campaignSource).toContain('rpc("recover_generation_items"');
    expect(migration).toContain("create or replace function public.recover_generation_items");
    expect(migration).toContain("delete from public.source_candidate_uses");
    expect(migration).toContain("for update of gi skip locked");
    expect(migration).toContain(
      "grant execute on function public.recover_generation_items(timestamptz, integer, boolean, boolean) to service_role",
    );
    expect(cloudflareRetryMigration).toContain("520|522|524");
    expect(cleanupMigration).toContain("recovered_stale_open_run");
    expect(renderStateRecoveryMigration).toContain("skip_linked_posts");
    expect(renderStateRecoveryMigration).toContain("p.generation_item_id = c.id");
    expect(renderStateRecoveryMigration).toContain("p.library_item_id = c.library_item_id");
    expect(renderStateRecoveryMigration).not.toContain("p.updated_at");
    expect(renderStateRecoveryMigration).toContain("generated_asset_id = null");
    expect(renderStateRecoveryMigration).toContain("stitched_asset_id = null");
    expect(renderStateRecoveryMigration).toContain("render_provider = null");
    expect(renderStateRecoveryMigration).toContain("duration_tolerance_seconds_used = null");
    expect(renderStateRecoveryMigration).toContain("perceptual_hash = null");
  });

  it("recovers stale open worker runs before starting a new worker run", () => {
    const workerHelper = readFileSync("supabase/functions/_shared/workers.ts", "utf8");

    expect(workerHelper).toContain("export async function recoverStaleWorkerRuns");
    expect(workerHelper).toContain('.from("worker_runs")');
    expect(workerHelper).toContain('.is("ended_at", null)');
    expect(workerHelper).toContain('.lt("started_at", staleBefore)');
    expect(workerHelper).toContain("recovered_stale_open_run");
    expect(workerHelper).toContain("recovered_by: functionName");
    expect(workerHelper).toContain("await recoverStaleWorkerRuns(functionName)");
  });

  it("keeps the newer sourcing status claimable by generation workers", () => {
    const migration = readFileSync(
      "supabase/migrations/20260518140500_fanagent_recovery_rpc.sql",
      "utf8",
    );

    expect(migration).toContain("create or replace function public.claim_generation_items");
    expect(migration).toContain("'sourcing'");
    expect(migration).toContain("where status in (\n    'pending'");
  });

  it("prioritizes queue claims for in-progress and nearly-complete libraries", () => {
    const migration = readFileSync(
      "supabase/migrations/20260519134500_fanagent_claim_library_completion_priority.sql",
      "utf8",
    );

    expect(migration).toContain("create or replace function public.claim_generation_items");
    expect(migration).toContain("left join lateral");
    expect(migration).toContain("from public.video_library_items vli");
    expect(migration).toContain("where vli.batch_id = gi.batch_id");
    expect(migration).toContain("library_progress.ready_count::numeric");
    expect(migration).toContain("nullif(library_progress.slot_count, 0)");
    expect(migration).toContain("when gi.status in ('ready','stitched','rendering'");
    expect(migration).toContain("Prioritizes in-progress work and batches closest");
  });

  it("adds batch-scoped queue claims and post indexes for immediate campaign rendering", () => {
    const migration = readFileSync(
      "supabase/migrations/20260521162606_fanagent_immediate_render_draft_slots.sql",
      "utf8",
    );

    expect(migration).toContain("p_batch_id uuid default null");
    expect(migration).toContain("and (p_batch_id is null or gi.batch_id = p_batch_id)");
    expect(migration).toContain("public.claim_generation_items(integer, text, integer, uuid)");
    expect(migration).toContain("idx_posts_library_item_id");
    expect(migration).toContain("idx_posts_generation_item_id");
    expect(migration).toContain("idx_posts_pending_blocked_schedule");
  });

  it("clears stale lock owner labels after retryable worker errors", () => {
    const migration = readFileSync(
      "supabase/migrations/20260519140000_fanagent_clear_stale_lock_owner.sql",
      "utf8",
    );

    expect(migration).toContain("update public.generation_items");
    expect(migration).toContain("set locked_by = null");
    expect(migration).toContain("where locked_at is null");
    expect(migration).toContain("status not in ('complete','failed','skipped')");
  });

  it("splits long generation work into claimable stages", () => {
    const workerSource = readFileSync("supabase/functions/fanpage-generate-due/index.ts", "utf8");

    expect(workerSource).toContain("async function releaseItemForNextStage");
    expect(workerSource).toContain("522");
    expect(workerSource).toContain("error_message: null");
    expect(workerSource).toContain('if (item.status === "stitched" && item.stock_clip_url)');
    expect(workerSource).toMatch(/invokeChild\("pick-stock-clip"[\s\S]+releaseItemForNextStage/);
    expect(workerSource).toMatch(
      /invokeChild\("generate-seedance-clip"[\s\S]+releaseItemForNextStage/,
    );
    expect(workerSource).toMatch(/invokeChild\("stitch-segments"[\s\S]+releaseItemForNextStage/);
  });

  it("keeps generation worker limits env-bounded and envelope-shaped", () => {
    const workerSource = readFileSync("supabase/functions/fanpage-generate-due/index.ts", "utf8");

    expect(workerSource).toContain("function maxPerRun(override?: unknown)");
    expect(workerSource).toContain('"FANAGENT_GENERATE_MAX_PER_RUN"');
    expect(workerSource).toContain("body.maxItems");
    expect(workerSource).toContain("p_batch_id: batchId ?? null");
    expect(workerSource).toContain("function childTimeoutMs()");
    expect(workerSource).toContain('"FANAGENT_CHILD_TIMEOUT_MS"');
    expect(workerSource).toContain("105_000");
    expect(workerSource).toContain("120_000");
    expect(workerSource).toContain("new AbortController()");
    expect(workerSource).toContain("signal: controller.signal");
    expect(workerSource).toContain("timed out after");
    expect(workerSource).toContain("timed\\s+out");
    expect(workerSource).toContain("Math.max(1, Math.min(Math.floor(configured), 10))");
    expect(workerSource).toContain("claimDueItems(maxItems, body.batchId)");
    expect(workerSource).toContain("locked_by: null");
    expect(workerSource).toContain("okEnvelope({");
    expect(workerSource).toContain("batchId: body.batchId ?? null");
    expect(workerSource).toContain(
      'errorEnvelope("Unauthorized cron call", "UNAUTHORIZED_CRON", 401)',
    );
    expect(workerSource).toContain('"GENERATION_WORKER_FAILED"');
    expect(workerSource).not.toContain("jsonResponse({ processed, errors, errorList })");
  });

  it("keeps batch and library rollups fresh after each generation worker claim", () => {
    const workerSource = readFileSync("supabase/functions/fanpage-generate-due/index.ts", "utf8");
    const legacyWorkerSource = readFileSync(
      "supabase/functions/process-generation-due/index.ts",
      "utf8",
    );

    expect(workerSource).toContain("update.completed_at = null");
    expect(workerSource).toContain("update.error_message = null");
    expect(workerSource).toContain('.select("quantity,post_count")');
    expect(workerSource).toContain("deriveBatchLibraryStatus(");
    expect(workerSource).toContain("requestedQuantity");
    expect(workerSource).toMatch(
      /if \(clearError\.error\) throw clearError\.error;[\s\S]+await refreshBatchStatus\(row\.batch_id\);[\s\S]+await refreshBatchLibraryStatus\(row\.batch_id\);[\s\S]+processed \+= 1;/,
    );
    expect(workerSource).toMatch(
      /if \(!retry\) \{[\s\S]+await failLinkedLibraryItem\(row, err\);[\s\S]+await refreshBatchLibraryStatus\(row\.batch_id\);[\s\S]+\}[\s\S]+await refreshBatchStatus\(row\.batch_id\);/,
    );
    expect(legacyWorkerSource).toContain("update.completed_at = null");
    expect(legacyWorkerSource).toContain("update.error_message = null");
  });

  it("keeps core generation child functions on the shared envelope contract", () => {
    const pickSource = readFileSync("supabase/functions/pick-stock-clip/index.ts", "utf8");
    const seedanceSource = readFileSync(
      "supabase/functions/generate-seedance-clip/index.ts",
      "utf8",
    );
    const stitchSource = readFileSync("supabase/functions/stitch-segments/index.ts", "utf8");

    for (const source of [pickSource, seedanceSource, stitchSource]) {
      expect(source).toContain("import { errorEnvelope, okEnvelope }");
      expect(source).toContain('errorEnvelope("Method not allowed", "METHOD_NOT_ALLOWED", 405)');
      expect(source).toContain("okEnvelope({");
      expect(source).not.toContain("jsonResponse({");
      expect(source).not.toContain("return errorResponse(error)");
    }
    expect(pickSource).toContain('"TOLERANCE_EXCEEDED"');
    expect(pickSource).toContain('"PICK_SOURCE_CLIP_FAILED"');
    expect(seedanceSource).toContain('"GENERATE_SEEDANCE_CLIP_FAILED"');
    expect(stitchSource).toContain("resolveMediaAssetUrl");
    expect(stitchSource).toContain('.select("public_url,storage_bucket,storage_path")');
    expect(stitchSource).toContain("audio_bucket");
    expect(stitchSource).not.toContain("audio.data.public_url");
    expect(stitchSource).toContain('"STITCH_SEGMENTS_FAILED"');
  });

  it("keeps internal prompt and transcription helpers envelope-shaped", () => {
    const promptSource = readFileSync("supabase/functions/generate-video-prompts/index.ts", "utf8");
    const transcribeSource = readFileSync("supabase/functions/transcribe-audio/index.ts", "utf8");

    for (const source of [promptSource, transcribeSource]) {
      expect(source).toContain("import { errorEnvelope, okEnvelope }");
      expect(source).toContain('errorEnvelope("Method not allowed", "METHOD_NOT_ALLOWED", 405)');
      expect(source).toContain("okEnvelope({");
      expect(source).not.toContain("jsonResponse({");
      expect(source).not.toContain("return errorResponse(error)");
      expect(source).toContain('import { isAuthorizedInternalCall } from "../_shared/internal.ts"');
      expect(source).toContain(
        'errorEnvelope("Unauthorized internal call.", "UNAUTHORIZED_INTERNAL", 401)',
      );
    }
    expect(promptSource).toContain('"GENERATE_VIDEO_PROMPTS_FAILED"');
    expect(transcribeSource).toContain('"TRANSCRIBE_AUDIO_FAILED"');
  });

  it("keeps worker-only generation functions behind the internal secret", () => {
    const internalSource = readFileSync("supabase/functions/_shared/internal.ts", "utf8");
    const functionPaths = [
      "supabase/functions/create-generation-batch/index.ts",
      "supabase/functions/source-candidate-search/index.ts",
      "supabase/functions/pick-stock-clip/index.ts",
      "supabase/functions/generate-seedance-clip/index.ts",
      "supabase/functions/stitch-segments/index.ts",
      "supabase/functions/render-karaoke/index.ts",
      "supabase/functions/library-finalize/index.ts",
      "supabase/functions/generate-video-prompts/index.ts",
      "supabase/functions/transcribe-audio/index.ts",
    ];

    expect(internalSource).toContain("export function isAuthorizedInternalCall");
    expect(internalSource).toContain('request.headers.get("x-cron-secret") === expected');

    for (const path of functionPaths) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain('import { isAuthorizedInternalCall } from "../_shared/internal.ts"');
      expect(source).toContain("if (!isAuthorizedInternalCall(request))");
      expect(source).toContain(
        'errorEnvelope("Unauthorized internal call.", "UNAUTHORIZED_INTERNAL", 401)',
      );
    }
  });

  it("passes the internal secret through generation child calls", () => {
    const fanpageWorker = readFileSync("supabase/functions/fanpage-generate-due/index.ts", "utf8");
    const legacyWorker = readFileSync("supabase/functions/process-generation-due/index.ts", "utf8");
    const renderSource = readFileSync("supabase/functions/render-karaoke/index.ts", "utf8");
    const replaceSource = readFileSync(
      "supabase/functions/source-candidate-replace/index.ts",
      "utf8",
    );

    for (const source of [fanpageWorker, legacyWorker, renderSource, replaceSource]) {
      expect(source).toContain('"x-cron-secret": optionalEnv("CRON_SECRET") ?? ""');
    }
    expect(fanpageWorker).toContain('invokeChild("transcribe-audio"');
    expect(fanpageWorker).toContain('invokeChild("pick-stock-clip"');
    expect(fanpageWorker).toContain('invokeChild("generate-seedance-clip"');
    expect(fanpageWorker).toContain('invokeChild("stitch-segments"');
    expect(fanpageWorker).toContain('invokeChild("render-karaoke"');
    expect(legacyWorker).toContain('invokeChild("library-finalize"');
    expect(renderSource).toContain('fetch(fnUrl("library-finalize")');
    expect(replaceSource).toContain('invokeChild("stitch-segments"');
    expect(replaceSource).toContain('invokeChild("render-karaoke"');
  });

  it("pins Vite dev React chunks to one runtime identity", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const main = readFileSync("src/main.tsx", "utf8");
    const viteConfig = readFileSync("vite.config.ts", "utf8");

    expect(app).toContain('if (mode === "autopilot") return <Navigate');
    expect(main).toContain('lazy(() => import("./pages/autopilot/AutopilotLayout"))');
    expect(main).not.toContain('lazy(() => import("@/components/AutopilotPanel"))');
    expect(viteConfig).toContain('dedupe: ["react", "react-dom"]');
    expect(viteConfig).toContain("node_modules/react");
    expect(viteConfig).toContain("node_modules/react-dom");
    expect(viteConfig).toContain('"react-dom/client"');
  });

  it("keeps persisted publish statuses aligned with the schema enum", () => {
    const publishSource = readFileSync("supabase/functions/publish-tiktok-due/index.ts", "utf8");
    const campaignSource = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");
    const regeneratedStatusMigration = readFileSync(
      "supabase/migrations/20260519071000_fanagent_regenerated_publish_status.sql",
      "utf8",
    );

    expect(publishSource).not.toContain("publish_status: data.status");
    expect(publishSource).toContain('publish_status: "publish_complete"');
    expect(publishSource).toContain('publish_status: "processing"');
    expect(campaignSource).toContain('publish_status: "regenerated"');
    expect(regeneratedStatusMigration).toContain("'regenerated'");
  });

  it("keeps the deprecated GMI worker on the library-first path", () => {
    const workerSource = readFileSync("supabase/functions/process-generation-due/index.ts", "utf8");
    const supabaseConfig = readFileSync("supabase/config.toml", "utf8");

    expect(workerSource).toContain("Deprecated legacy worker");
    expect(workerSource).toContain("isAuthorizedCronCall");
    expect(supabaseConfig).toContain("[functions.process-generation-due]\nverify_jwt = false");
    expect(workerSource).toContain("import { errorEnvelope, okEnvelope }");
    expect(workerSource).toContain(
      'errorEnvelope("Method not allowed.", "METHOD_NOT_ALLOWED", 405)',
    );
    expect(workerSource).toContain(
      'errorEnvelope("Unauthorized cron call", "UNAUTHORIZED_CRON", 401)',
    );
    expect(workerSource).toContain("okEnvelope({ processed: results.length, results })");
    expect(workerSource).toContain('"PROCESS_GENERATION_DUE_FAILED"');
    expect(workerSource).toContain("renderedVideoStoragePath");
    expect(workerSource).toContain("finalizeLibraryItem");
    expect(workerSource).toContain("finalizeLibraryItemFromVideo");
    expect(workerSource).not.toContain("jsonResponse({ processed: results.length, results })");
    expect(workerSource).not.toContain("return errorResponse(error)");
    expect(workerSource).not.toContain("async function createPostFromVideo");
    expect(workerSource).not.toContain('.from("posts")');
    expect(workerSource).not.toContain("post_id:");
    expect(workerSource).not.toContain('return { id: item.id, status: "complete", postId');
  });

  it("keeps the legacy render callback on the shared envelope contract", () => {
    const callbackSource = readFileSync("supabase/functions/render-callback/index.ts", "utf8");

    expect(callbackSource).toContain("import { errorEnvelope, okEnvelope }");
    expect(callbackSource).toContain(
      'errorEnvelope("Invalid callback token", "INVALID_CALLBACK_TOKEN", 401)',
    );
    expect(callbackSource).toContain('okEnvelope({ status: "failed" })');
    expect(callbackSource).toContain('okEnvelope({ status: "ready" })');
    expect(callbackSource).toContain('"RENDER_CALLBACK_FAILED"');
    expect(callbackSource).not.toContain("jsonResponse({ ok: true");
    expect(callbackSource).not.toContain("return errorResponse(error)");
  });

  it("rerenders replaced source candidates through stitch and karaoke", () => {
    const replaceSource = readFileSync(
      "supabase/functions/source-candidate-replace/index.ts",
      "utf8",
    );
    const searchSource = readFileSync(
      "supabase/functions/source-candidate-search/index.ts",
      "utf8",
    );
    const pickSource = readFileSync("supabase/functions/pick-stock-clip/index.ts", "utf8");

    expect(replaceSource).toContain("buildLibrarySegmentReplacement");
    expect(replaceSource).toContain('body.action === "searchCandidates"');
    expect(replaceSource).toContain('invokeChild("source-candidate-search"');
    expect(replaceSource).toContain('invokeChild("stitch-segments"');
    expect(replaceSource).toContain('invokeChild("render-karaoke"');
    expect(replaceSource).toContain('"x-cron-secret": optionalEnv("CRON_SECRET") ?? ""');
    expect(searchSource).toContain(
      'import { isAuthorizedInternalCall } from "../_shared/internal.ts"',
    );
    expect(searchSource).toContain("if (!isAuthorizedInternalCall(request))");
    expect(searchSource).toContain('"UNAUTHORIZED_INTERNAL"');
    expect(pickSource).toContain('invokeChild("source-candidate-search"');
    expect(pickSource).toContain('"x-cron-secret": optionalEnv("CRON_SECRET") ?? ""');
    expect(replaceSource).toContain('status: "not_ready"');
    expect(replaceSource).toContain('status: "picking_stock"');
  });

  it("records render attempts for the normal render pipeline", () => {
    const helperSource = readFileSync("supabase/functions/_shared/render-attempts.ts", "utf8");
    const seedanceSource = readFileSync(
      "supabase/functions/generate-seedance-clip/index.ts",
      "utf8",
    );
    const stitchSource = readFileSync("supabase/functions/stitch-segments/index.ts", "utf8");
    const karaokeSource = readFileSync("supabase/functions/render-karaoke/index.ts", "utf8");

    expect(helperSource).toContain('.from("render_attempts")');
    expect(seedanceSource).toContain("withRenderAttempt");
    expect(seedanceSource).toContain('stage: "sourcing"');
    expect(stitchSource).toContain("withRenderAttempt");
    expect(stitchSource).toContain('stage: "stitch"');
    expect(stitchSource).toContain("single_segment_merge");
    expect(karaokeSource).toContain("withRenderAttempt");
    expect(karaokeSource).toContain('stage: "karaoke"');
    expect(karaokeSource).toContain('stage: "thumbnail"');
    expect(karaokeSource).toContain('stage: "finalize"');
  });

  it("creates a missing video library slot during karaoke render for recovered legacy items", () => {
    const karaokeSource = readFileSync("supabase/functions/render-karaoke/index.ts", "utf8");

    expect(karaokeSource).toContain('.from("video_library_items")');
    expect(karaokeSource).not.toContain("No video library item is linked");
    expect(karaokeSource).toContain("generation_item_id: item.id");
    expect(karaokeSource).toContain('status: "not_ready"');
    expect(karaokeSource).toContain("duration_sec: item.duration_seconds ?? 15");
    expect(karaokeSource).toContain("return inserted.data.id");
  });

  it("backfills missing library slots for legacy batches before render finalization", () => {
    const migration = readFileSync(
      "supabase/migrations/20260519131500_fanagent_backfill_missing_library_slots.sql",
      "utf8",
    );

    expect(migration).toContain("where gi.library_item_id is null");
    expect(migration).toContain("insert into public.video_library_items");
    expect(migration).toContain("on conflict (audio_clip_id, library_index) do update");
    expect(migration).toContain("backfilled_missing_library_slot");
    expect(migration).toContain("set library_item_id = inserted_slots.id");
    expect(migration).toContain("left join public.video_library_items vli on vli.batch_id = gb.id");
    expect(migration).toContain("when br.slot_count < br.requested_quantity then 'building'");
  });

  it("normalizes recovered batch rollups from current generation and library rows", () => {
    const migration = readFileSync(
      "supabase/migrations/20260519133000_fanagent_refresh_batch_rollups.sql",
      "utf8",
    );

    expect(migration).toContain("with generation_rollups as");
    expect(migration).toContain("left join public.generation_items gi on gi.batch_id = gb.id");
    expect(migration).toContain("left join public.video_library_items vli on vli.batch_id = gb.id");
    expect(migration).toContain("when gr.complete_count = gr.item_count then 'complete'");
    expect(migration).toContain("when lr.slot_count < lr.requested_quantity then 'building'");
    expect(migration).toContain("when nr.next_status = 'generating' then null");
    expect(migration).toContain("gb.completed_at is not null");
  });

  it("keeps the karaoke renderer response envelope-shaped", () => {
    const karaokeSource = readFileSync("supabase/functions/render-karaoke/index.ts", "utf8");

    expect(karaokeSource).toContain("import { errorEnvelope, okEnvelope }");
    expect(karaokeSource).toContain(
      'errorEnvelope("Method not allowed", "METHOD_NOT_ALLOWED", 405)',
    );
    expect(karaokeSource).toContain("okEnvelope({");
    expect(karaokeSource).toContain('"RENDER_KARAOKE_FAILED"');
    expect(karaokeSource).not.toContain("jsonResponse({");
    expect(karaokeSource).not.toContain("return errorResponse(error)");
  });

  it("persists rendered video fingerprints through karaoke finalize", () => {
    const karaokeSource = readFileSync("supabase/functions/render-karaoke/index.ts", "utf8");

    expect(karaokeSource).toContain("contentFingerprint64(dl.bytes)");
    expect(karaokeSource).toContain("perceptual_hash: perceptualHash");
    expect(karaokeSource).toContain('perceptual_hash_kind: "sha256_64_content_fingerprint"');
    expect(karaokeSource).toContain("perceptual_hash: rendered.perceptualHash");
  });

  it("hydrates draft calendar posts when library finalize marks a render ready", () => {
    const finalizeSource = readFileSync("supabase/functions/library-finalize/index.ts", "utf8");

    expect(finalizeSource).toContain("async function hydrateDraftPosts");
    expect(finalizeSource).toContain('publishStatus = needsReview ? "blocked_review_required"');
    expect(finalizeSource).toContain("final_asset_id: input.finalAssetId");
    expect(finalizeSource).toContain("video_url: input.videoUrl");
    expect(finalizeSource).toContain(
      "Render complete. Review and save this post before publishing.",
    );
    expect(finalizeSource).toContain("await hydrateDraftPosts({");
  });
});

describe("GMI parsing", () => {
  it("finds video artifacts in nested outcomes", () => {
    const url = findGmiVideoUrl({
      outcome: {
        artifacts: [
          { thumbnail: "https://example.com/image.jpg" },
          { video_url: "https://cdn.example.com/final.mp4" },
        ],
      },
    });

    expect(url).toBe("https://cdn.example.com/final.mp4");
  });
});

describe("TikTok request helpers", () => {
  it("builds FILE_UPLOAD chunks and Direct Post init bodies", () => {
    const body = buildDirectPostInitBody(
      {
        title: "sound on #music",
        privacyLevel: "SELF_ONLY",
        disableDuet: true,
        disableComment: false,
        disableStitch: true,
        isAigc: true,
        brandContentToggle: false,
        brandOrganicToggle: false,
      },
      24 * 1024 * 1024,
    );

    expect(createChunkPlan(24 * 1024 * 1024)).toEqual({
      chunkSize: 10 * 1024 * 1024,
      totalChunkCount: 3,
    });
    expect(body).toMatchObject({
      post_info: {
        privacy_level: "SELF_ONLY",
        is_aigc: true,
      },
      source_info: {
        source: "FILE_UPLOAD",
        total_chunk_count: 3,
      },
    });
  });

  it("parses publish status responses and rejects TikTok errors", () => {
    expect(
      parseTikTokStatusResponse(
        JSON.stringify({
          data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["123"] },
          error: { code: "ok", message: "" },
        }),
      ).status,
    ).toBe("PUBLISH_COMPLETE");

    expect(() =>
      parseTikTokStatusResponse(
        JSON.stringify({
          error: { code: "invalid_publish_id", message: "bad id" },
        }),
      ),
    ).toThrow("invalid_publish_id");
  });

  it("validates privacy levels against creator options", () => {
    expect(
      isTikTokPrivacyLevelAllowed("SELF_ONLY", {
        privacy_level_options: ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS"],
      }),
    ).toBe(true);
    expect(
      isTikTokPrivacyLevelAllowed("PUBLIC_TO_EVERYONE", {
        privacy_level_options: ["SELF_ONLY"],
      }),
    ).toBe(false);
    expect(isTikTokPrivacyLevelAllowed(null, {})).toBe(false);
  });
});
