# Make queued stock items actually render

## Root cause

- `fanpage-generate-due` is the worker that owns stock items (transcribe → pick-stock → stitch → render-karaoke → create post). It is **never called**: no `cron.job` row, no UI button, and it is gated behind `x-cron-secret` so the browser cannot invoke it directly.
- The "Generate due" button in `src/App.tsx:333` calls `process-generation-due`, which is now intentionally limited to `gmi_seedance` / `remote_render` providers — so it's a no-op for the queued `provider: stock` items.
- Net effect: items stay `pending` forever (or get marked `failed` by old GMI runs).

## Fix

### 1. Manual trigger from the UI

In `src/App.tsx` "Generate due" handler, invoke **both** workers in parallel:
- `process-generation-due` (existing GMI/remote path)
- `fanpage-generate-due` (stock + fal.ai path)

Both are deployed Edge Functions; the user is authenticated so `supabase.functions.invoke` works for `process-generation-due`. For `fanpage-generate-due` we need to drop the cron-secret gate when the caller has a valid Supabase user JWT.

### 2. Allow authenticated manual calls to `fanpage-generate-due`

Update `_shared/workers.ts::isAuthorizedCronCall` to also accept any request whose `Authorization: Bearer <jwt>` resolves to a real Supabase user. Keep the `x-cron-secret` path for cron. Apply the same logic to `fanpage-publish-due` (it uses the same helper).

Keep `verify_jwt = false` in `config.toml` (we validate manually inside the function) so cron calls without a JWT still work.

### 3. Schedule the workers via pg_cron

Add a migration that:
- Enables `pg_cron` and `pg_net` extensions if not already.
- Schedules `fanpage-generate-due` every minute.
- Schedules `fanpage-publish-due` every minute.
- Both calls use `net.http_post` with the `x-cron-secret` header read from a Vault secret OR pasted constant (project already has `CRON_SECRET` set in Edge Function env; we'll store it in `vault.secrets` so the cron job can read it without leaking).

If Vault is awkward, fall back to storing the cron secret in a tiny `app_secrets` table readable only by `service_role` (postgres role used by cron is `postgres`, which bypasses RLS). The migration will create the row from `current_setting('app.cron_secret', true)` if set, otherwise leave it for the user to insert.

### 4. Verify

After deploy:
- Click "Generate due" in the UI → both workers run; check `worker_runs` for new rows for `fanpage-generate-due`, and `generation_items` advance through `transcribing → stitched → ready → complete` with `post_id` populated.
- Wait one minute → `cron.job_run_details` shows successful tick of both workers.

## Files touched

- `src/App.tsx` — "Generate due" handler invokes both workers in parallel.
- `supabase/functions/_shared/workers.ts` — accept authenticated user JWT in addition to `x-cron-secret`.
- `supabase/migrations/<new>.sql` — enable `pg_cron`/`pg_net`, schedule both workers.

## Out of scope

- No changes to render-karaoke, stitch-segments, or the lyrics UI (already built last turn).
- No GMI / Remotion changes.
