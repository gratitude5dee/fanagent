import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({
    data: { success: true, data: { ok: true, status: "pending" } },
    error: null,
  })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: mocks.invoke,
    },
  },
}));

import { regenerateLibraryItems } from "../src/lib/library/api";

describe("library API wrappers", () => {
  it("sends library item targets when generation item ids are missing", async () => {
    mocks.invoke.mockClear();

    await regenerateLibraryItems([
      { libraryItemId: "library-1", generationItemId: null },
      { libraryItemId: "library-2", generationItemId: "generation-2" },
    ]);

    expect(mocks.invoke.mock.calls).toEqual([
      ["fanpage-campaign", { body: { action: "regenerate", libraryItemId: "library-1" } }],
      [
        "fanpage-campaign",
        {
          body: {
            action: "regenerate",
            generationItemId: "generation-2",
            itemId: "generation-2",
            libraryItemId: "library-2",
          },
        },
      ],
    ]);
  });
});
