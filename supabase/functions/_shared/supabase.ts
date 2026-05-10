import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { requireEnv } from "./env.ts";

export function getSupabaseAdmin() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
