import { optionalEnv } from "./env.ts";

export function isAuthorizedInternalCall(request: Request): boolean {
  const expected = optionalEnv("CRON_SECRET");
  return !!expected && request.headers.get("x-cron-secret") === expected;
}
