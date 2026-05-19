import type { Account } from "./types";

export type AccountTone = "good" | "warn" | "idle" | "bad";

export type AccountConnectionState = {
  label: string;
  tone: AccountTone;
  connected: boolean;
};

type AccountIdentity = Pick<
  Account,
  "id" | "platform" | "handle" | "status" | "tiktok_connected_at" | "tiktok_display_name"
>;

export function buildTikTokConnectUrl(supabaseUrl: string, accountId: string): string {
  return `${supabaseUrl}/functions/v1/tiktok-oauth-callback?action=connect&accountId=${encodeURIComponent(accountId)}`;
}

export function accountDisplayName(account: AccountIdentity): string {
  return (
    account.tiktok_display_name ||
    account.handle ||
    `${account.platform || "account"} ${account.id.slice(0, 8)}`
  );
}

export function accountHandleLabel(account: Pick<Account, "handle">): string {
  if (!account.handle) return "No handle";
  return account.handle.startsWith("@") ? account.handle : `@${account.handle}`;
}

export function accountConnectionState(account: AccountIdentity): AccountConnectionState {
  if (account.tiktok_connected_at) {
    return { label: "connected", tone: "good", connected: true };
  }
  if (account.status === "failed" || account.status === "disabled") {
    return { label: account.status, tone: "bad", connected: false };
  }
  if (account.platform === "tiktok") {
    return { label: "needs connection", tone: "warn", connected: false };
  }
  return { label: account.status || "not connected", tone: "idle", connected: false };
}

export function tiktokPrivacyOptions(creatorInfo: Record<string, unknown> | null): string[] {
  const options = creatorInfo?.privacy_level_options;
  return Array.isArray(options) ? options.map(String) : [];
}

export function creatorRestrictionBadges(creatorInfo: Record<string, unknown> | null): string[] {
  if (!creatorInfo) return [];

  const badges: string[] = [];
  const privacyOptions = tiktokPrivacyOptions(creatorInfo);
  if (privacyOptions.length > 0) badges.push(`${privacyOptions.length} privacy options`);
  if (creatorInfo.duet_disabled === true) badges.push("Duet disabled");
  if (creatorInfo.stitch_disabled === true) badges.push("Stitch disabled");
  if (creatorInfo.comment_disabled === true) badges.push("Comments disabled");
  if (creatorInfo.max_video_post_duration_sec) {
    badges.push(`${String(creatorInfo.max_video_post_duration_sec)}s max`);
  }
  return badges;
}
