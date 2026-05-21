import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeEdgeFunction: vi.fn(async () => ({})),
}));

vi.mock("@/lib/fanagent/invokeFunction", () => ({
  invokeEdgeFunction: mocks.invokeEdgeFunction,
}));

import { campaignsApi } from "../src/lib/campaigns/api";

describe("campaigns API wrappers", () => {
  it("sends exact fanpage-campaign action bodies", async () => {
    await campaignsApi.list("account-1");
    await campaignsApi.pause("batch-1");
    await campaignsApi.resume("batch-1");
    await campaignsApi.cancel("batch-1");
    await campaignsApi.regenerate("item-1");
    await campaignsApi.skip("item-1");
    await campaignsApi.setLyricTemplate("item-1", "template-1");

    expect(mocks.invokeEdgeFunction.mock.calls).toEqual([
      ["fanpage-campaign", { action: "list", accountId: "account-1" }],
      ["fanpage-campaign", { action: "pause", batchId: "batch-1" }],
      ["fanpage-campaign", { action: "resume", batchId: "batch-1" }],
      ["fanpage-campaign", { action: "cancel", batchId: "batch-1" }],
      ["fanpage-campaign", { action: "regenerate", itemId: "item-1" }],
      ["fanpage-campaign", { action: "skip", itemId: "item-1" }],
      [
        "fanpage-campaign",
        { action: "setLyricTemplate", itemId: "item-1", lyricTemplateId: "template-1" },
      ],
    ]);
  });
});
