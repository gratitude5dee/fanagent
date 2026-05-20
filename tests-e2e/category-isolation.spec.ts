// Category isolation E2E.
//
// Security property under test: a campaign tagged for Basketball must NEVER
// stitch a non-basketball clip. Seeds a basketball-only candidate pool, a
// football decoy pool, runs an instant-render remix through library-remix,
// and asserts every clip used by every library item carries the basketball
// category_id.
//
// Gated on hasProviderFlowCredentials because the worker needs Pexels/fal
// keys + the full render pipeline. Without those creds, this skips cleanly
// but the security invariant is still covered by tests/pool-isolation.test.ts.

import { test, expect } from "@playwright/test";
import {
  adminClient,
  cleanupAccount,
  hasProviderFlowCredentials,
  seedPrimaryAccount,
} from "./helpers";

test.describe("category isolation e2e", () => {
  test.skip(
    !hasProviderFlowCredentials,
    "Set E2E_RUN_PROVIDER_FLOW=1 plus Supabase + provider credentials.",
  );

  test("basketball campaign never uses a football clip", async () => {
    const client = adminClient();
    const accountId = await seedPrimaryAccount(client);

    try {
      // 1. Resolve category ids (seeded in Phase 1 migration).
      const cats = await client
        .from("clip_categories")
        .select("id,slug,parent_id")
        .in("slug", ["sports_edits", "sports_edits_basketball", "sports_edits_football"]);
      expect(cats.error).toBeNull();
      const basketball = cats.data?.find((c) => c.slug === "sports_edits_basketball");
      const football = cats.data?.find((c) => c.slug === "sports_edits_football");
      const sportsParent = cats.data?.find((c) => c.slug === "sports_edits");
      expect(basketball).toBeTruthy();
      expect(football).toBeTruthy();
      expect(sportsParent).toBeTruthy();

      // 2. Seed 8 basketball + 8 football decoy candidates for this account.
      const baseCandidate = {
        account_id: accountId,
        source_type: "sports_edit" as const,
        provider: "test-seed",
        duration_seconds: 15,
        is_portrait: true,
        license: "youtube_owner_provided" as const,
        rights_holder: "e2e",
        attribution: "e2e",
      };
      const seeds = [
        ...Array.from({ length: 8 }, (_, i) => ({
          ...baseCandidate,
          external_id: `bball-${i}`,
          origin_url: `https://e2e.example.com/basketball/${i}.mp4`,
          category_id: sportsParent!.id,
          subcategory_slug: "sports_edits_basketball",
        })),
        ...Array.from({ length: 8 }, (_, i) => ({
          ...baseCandidate,
          external_id: `football-${i}`,
          origin_url: `https://e2e.example.com/football/${i}.mp4`,
          category_id: sportsParent!.id,
          subcategory_slug: "sports_edits_football",
        })),
      ];
      const insert = await client.from("source_candidates").insert(seeds);
      expect(insert.error).toBeNull();

      // 3. Find a saved basketball-ready lyric template for this account. The
      // test environment is expected to have one seeded; if not, skip.
      const tpl = await client
        .from("kanvas_lyric_templates")
        .select("id,audio_clip_id,status")
        .eq("status", "saved")
        .limit(1)
        .maybeSingle();
      test.skip(!tpl.data, "No saved lyric template available in E2E env.");

      // 4. Fire library-remix with auto-render basketball.
      const remixUrl = `${process.env.E2E_SUPABASE_URL}/functions/v1/library-remix`;
      const remixRes = await fetch(remixUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          lyricTemplateId: tpl.data!.id,
          categoryId: sportsParent!.id,
          subcategorySlug: "sports_edits_basketball",
          count: 1,
        }),
      });
      expect(remixRes.ok).toBe(true);

      // 5. Poll for the resulting library item to reach ready, then assert
      //    every used candidate is basketball-tagged.
      const deadline = Date.now() + 120_000;
      let ready: { id: string; provenance: unknown[] } | null = null;
      while (Date.now() < deadline && !ready) {
        const rows = await client
          .from("video_library_items")
          .select("id,status,provenance")
          .eq("account_id", accountId)
          .eq("status", "ready")
          .order("updated_at", { ascending: false })
          .limit(1);
        const row = rows.data?.[0] as { id: string; provenance: unknown[] } | undefined;
        if (row) ready = row;
        else await new Promise((r) => setTimeout(r, 3000));
      }
      expect(ready, "library item never reached ready").toBeTruthy();

      const usedCandidateIds = ((ready!.provenance as Array<{ candidate_id?: string }>) ?? [])
        .map((p) => p.candidate_id)
        .filter((id): id is string => typeof id === "string");
      expect(usedCandidateIds.length).toBeGreaterThan(0);

      const used = await client
        .from("source_candidates")
        .select("id,subcategory_slug")
        .in("id", usedCandidateIds);
      expect(used.error).toBeNull();
      for (const row of used.data ?? []) {
        expect(row.subcategory_slug).toBe("sports_edits_basketball");
      }
    } finally {
      await cleanupAccount(accountId, client);
    }

  });
});
