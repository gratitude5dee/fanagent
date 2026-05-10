import { errorResponse, handleOptions } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import {
  buildAuthorizeUrl,
  decodeOAuthState,
  exchangeCode,
  getAccessToken,
  queryCreatorInfo,
  saveTokens,
} from "../_shared/tiktok.ts";

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location },
  });
}

function siteUrl(): string {
  return optionalEnv("SITE_URL") ?? optionalEnv("PUBLIC_SITE_URL") ??
    "http://localhost:8080";
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const url = new URL(request.url);
    if (url.searchParams.get("action") === "connect") {
      const accountId = url.searchParams.get("accountId");
      if (!accountId) return errorResponse("accountId is required.", 400);
      return redirect(buildAuthorizeUrl(accountId));
    }

    const error = url.searchParams.get("error");
    if (error) {
      return redirect(
        `${siteUrl()}?tiktok=error&reason=${encodeURIComponent(error)}`,
      );
    }

    const code = url.searchParams.get("code");
    const stateValue = url.searchParams.get("state");
    if (!code || !stateValue) {
      return errorResponse("TikTok callback requires code and state.", 400);
    }

    const state = decodeOAuthState(stateValue);
    if (Date.now() - state.createdAt > 30 * 60_000) {
      throw new Error("TikTok OAuth state expired.");
    }

    const tokens = await exchangeCode(code);
    await saveTokens(state.accountId, tokens);

    const accessToken = await getAccessToken(state.accountId);
    const creatorInfo = await queryCreatorInfo(accessToken);
    const creatorUsername = typeof creatorInfo.creator_username === "string"
      ? creatorInfo.creator_username
      : null;
    const creatorNickname = typeof creatorInfo.creator_nickname === "string"
      ? creatorInfo.creator_nickname
      : null;

    const supabase = getSupabaseAdmin();
    const updated = await supabase
      .from("accounts")
      .update({
        handle: creatorUsername ?? creatorNickname,
        tiktok_display_name: creatorNickname ?? creatorUsername,
        tiktok_creator_info: creatorInfo,
        status: "connected",
        is_primary: true,
      })
      .eq("id", state.accountId);
    if (updated.error) throw updated.error;

    // V1: enforce one primary per artist by demoting any others.
    await supabase
      .from("accounts")
      .update({ is_primary: false })
      .eq("platform", "tiktok")
      .neq("id", state.accountId);

    return redirect(
      `${siteUrl()}?tiktok=connected&accountId=${
        encodeURIComponent(state.accountId)
      }`,
    );
  } catch (error) {
    return errorResponse(error);
  }
});
