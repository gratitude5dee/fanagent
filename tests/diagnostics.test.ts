import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isFanAgentSchemaReady,
  missingSchemaChecks,
  schemaDiagnosticsSummary,
} from "../src/lib/fanagent/diagnostics";

const readySchema = {
  generationBatchesSettings: true,
  generationItemsQueueColumns: true,
  workerRuns: true,
  audioClips: true,
  videoLibrary: true,
  sourceCandidates: true,
  sourceCandidateUses: true,
  renderAttempts: true,
  postScheduleSlots: true,
  errors: [],
};

describe("FanAgent diagnostics schema readiness", () => {
  it("treats a fully-checked schema as ready and reports missing tables for diagnostics", () => {
    expect(isFanAgentSchemaReady(readySchema)).toBe(true);
    expect(
      missingSchemaChecks({
        ...readySchema,
        audioClips: false,
        videoLibrary: false,
      }),
    ).toEqual(["audio_clips", "video_library_items"]);
  });

  it("only blocks readiness when the server reports a hard error, not on transient per-table flips", () => {
    // Transient timeout → per-table boolean may be false but errors[] stays empty.
    expect(
      isFanAgentSchemaReady({
        ...readySchema,
        audioClips: false,
        errors: [],
        warnings: ["audio_clips timed out after 10000ms"],
      }),
    ).toBe(true);
    // Hard non-transient failure → errors[] populated.
    expect(
      isFanAgentSchemaReady({
        ...readySchema,
        audioClips: false,
        errors: ["Could not find the table 'public.audio_clips' in the schema cache"],
      }),
    ).toBe(false);
  });


  it("summarizes explicit schema cache errors ahead of derived missing labels", () => {
    expect(
      schemaDiagnosticsSummary({
        ...readySchema,
        audioClips: false,
        errors: ["Could not find the table 'public.audio_clips' in the schema cache"],
      }),
    ).toBe("Could not find the table 'public.audio_clips' in the schema cache");
  });

  it("keeps live diagnostics checking the original missing table names", () => {
    const source = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");

    expect(source).toContain('.from("audio_clips")');
    expect(source).toContain('.from("video_library_items")');
    expect(source).toContain('.from("source_candidate_uses")');
    expect(source).toContain('.from("post_schedule_slots")');
    expect(source).toContain('checkSchema("audio_clips"');
    expect(source).toContain("function withTimeout");
    expect(source).toContain("function queryWithTimeout");
    expect(source).toContain("const DIAGNOSTIC_SCHEMA_TIMEOUT_MS = 10_000");
    expect(source).toContain("const DIAGNOSTIC_DATA_TIMEOUT_MS = 10_000");
    expect(source).toContain("const DIAGNOSTIC_STORAGE_TIMEOUT_MS = 10_000");
    expect(source).toContain(".limit(0)");
    expect(source).toContain("audioClips: schemaChecks[3].ok");
    expect(source).toContain("videoLibrary: schemaChecks[4].ok");
    expect(source).toContain("sourceCandidateUses: schemaChecks[6].ok");
    expect(source).toContain("postScheduleSlots: schemaChecks[8].ok");
    expect(source).toContain("isTransientSchemaError");
    expect(source).toContain("transient?: boolean");
    expect(source).toContain("schemaErrors");
    expect(source).toContain("schemaWarnings");
    expect(source).toContain("errors: schemaErrors");
    expect(source).toContain("warnings: schemaWarnings");
  });

  it("falls back to storage.buckets when listBuckets cannot prove bucket presence", () => {
    const source = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");

    expect(source).toContain("async function loadStorageBucketNames");
    expect(source).toContain("supabase.storage.listBuckets()");
    expect(source).toContain("supabase.storage.getBucket(name)");
    expect(source).toContain('.schema("storage")');
    expect(source).toContain('.from("buckets")');
    expect(source).toContain('.in("id", expectedBuckets)');
    expect(source).toContain("bucketError: storageBuckets.error");
    expect(source).toContain("storage.listBuckets");
    expect(source).toContain("timed out after");
    expect(source).toContain("storage.getBucket");
  });

  it("does not keep stale worker errors active after failed items recover", () => {
    const source = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");

    expect(source).toContain("const failedItems = recentFailedItems.data ?? []");
    expect(source).toContain("const latestWorkerRun = workerRuns[0] ?? null");
    expect(source).toContain(
      "failedItems.length > 0 || Number(latestWorkerRun?.errors_count ?? 0) > 0",
    );
    expect(source).toContain("hasCurrentWorkerProblem");
    expect(source).toContain("recentFailedItems: failedItems");
  });

  it("bounds diagnostic worker-run detail so transient HTML errors stay readable", () => {
    const source = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20260519143200_fanagent_clip_legacy_worker_error_details.sql",
      "utf8",
    );

    expect(source).toContain("function clipDiagnosticString");
    expect(source).toContain("function sanitizeDiagnosticValue");
    expect(source).toContain("sanitizeDiagnosticValue(run.detail)");
    expect(migration).toContain("left(detail->>'fatal', 1200)");
    expect(migration).toContain("'{fatalDetail,message}'");
  });

  it("bounds dashboard list queries so the Autopilot panel can still render during slow reads", () => {
    const source = readFileSync("supabase/functions/fanpage-campaign/index.ts", "utf8");

    expect(source).toContain('case "list":');
    expect(source).toContain("queryWithTimeout(");
    expect(source).toContain('"list generation_batches"');
    expect(source).toContain('"list generation_items"');
    expect(source).toContain('"list posts"');
    expect(source).toContain('"list lyric templates"');
    expect(source).toContain("warnings,");
  });
});
