import { describe, expect, it } from "vitest";
import {
  assertCandidateInCategory,
  assertPoolIsolation,
  CategoryIsolationViolation,
} from "../supabase/functions/_shared/sources/pool.ts";
import type { SourceCandidate } from "../supabase/functions/_shared/sources/types.ts";

const basketballCat = "cat-basketball";
const footballCat = "cat-football";

function make(
  id: string,
  category_id: string | null,
  subcategory_slug: string | null = null,
): SourceCandidate {
  return {
    id,
    source_type: "sports_edit",
    provider: "youtube",
    external_id: id,
    origin_url: `https://example.com/${id}.mp4`,
    duration_seconds: 15,
    is_portrait: true,
    license: "youtube_owner_provided",
    rights_holder: "rights",
    attribution: "attr",
    category_id,
    subcategory_slug,
  };
}

describe("category isolation guard", () => {
  it("passes when every candidate matches expected category", () => {
    const pool = [
      make("a", basketballCat, "sports_edits_basketball"),
      make("b", basketballCat, "sports_edits_basketball"),
    ];
    expect(() => assertPoolIsolation(pool, basketballCat, "sports_edits_basketball")).not.toThrow();
  });

  it("throws when a foreign category leaks into the pool", () => {
    const pool = [
      make("a", basketballCat, "sports_edits_basketball"),
      make("leak", footballCat, "sports_edits_football"),
    ];
    expect(() => assertPoolIsolation(pool, basketballCat, "sports_edits_basketball")).toThrow(
      CategoryIsolationViolation,
    );
  });

  it("throws when subcategory mismatches even within same parent", () => {
    expect(() =>
      assertCandidateInCategory(
        make("a", basketballCat, "sports_edits_football"),
        basketballCat,
        "sports_edits_basketball",
      ),
    ).toThrow(CategoryIsolationViolation);
  });

  it("allows untagged subcategory when caller does not require one", () => {
    expect(() =>
      assertCandidateInCategory(make("a", basketballCat, null), basketballCat, null),
    ).not.toThrow();
  });

  it("rejects null category when one is expected", () => {
    expect(() =>
      assertCandidateInCategory(make("a", null), basketballCat, null),
    ).toThrow(CategoryIsolationViolation);
  });
});
