import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accountConnectionState,
  accountDisplayName,
  buildTikTokConnectUrl,
  creatorRestrictionBadges,
  tiktokPrivacyOptions,
} from "../src/lib/fanagent/accounts";
import type { Account } from "../src/lib/fanagent/types";

const disconnectedAccount: Account = {
  id: "account 123",
  platform: "tiktok",
  handle: "artist",
  status: "pending",
  tiktok_connected_at: null,
  tiktok_display_name: null,
  tiktok_creator_info: null,
};

describe("accounts UI helpers", () => {
  it("builds the TikTok OAuth connect URL with an encoded account id", () => {
    expect(buildTikTokConnectUrl("https://project.supabase.co", disconnectedAccount.id)).toBe(
      "https://project.supabase.co/functions/v1/tiktok-oauth-callback?action=connect&accountId=account%20123",
    );
  });

  it("uses TikTok display names before handles and account ids", () => {
    expect(accountDisplayName(disconnectedAccount)).toBe("artist");
    expect(
      accountDisplayName({
        ...disconnectedAccount,
        tiktok_display_name: "Artist Display",
      }),
    ).toBe("Artist Display");
  });

  it("maps disconnected TikTok accounts to the warning state", () => {
    expect(accountConnectionState(disconnectedAccount)).toEqual({
      label: "needs connection",
      tone: "warn",
      connected: false,
    });
    expect(
      accountConnectionState({
        ...disconnectedAccount,
        tiktok_connected_at: "2026-05-18T12:00:00.000Z",
      }),
    ).toEqual({
      label: "connected",
      tone: "good",
      connected: true,
    });
  });

  it("summarizes creator publishing limits from TikTok creator info", () => {
    const creatorInfo = {
      privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
      duet_disabled: true,
      stitch_disabled: true,
      comment_disabled: false,
      max_video_post_duration_sec: 60,
    };

    expect(tiktokPrivacyOptions(creatorInfo)).toEqual(["SELF_ONLY", "PUBLIC_TO_EVERYONE"]);
    expect(creatorRestrictionBadges(creatorInfo)).toEqual([
      "2 privacy options",
      "Duet disabled",
      "Stitch disabled",
      "60s max",
    ]);
  });

  it("wires the required accounts route into the router", () => {
    const source = readFileSync("src/main.tsx", "utf8");

    expect(source).toContain('import("./pages/settings/AccountsPage")');
    expect(source).toContain('path="/settings/accounts"');
  });
});
