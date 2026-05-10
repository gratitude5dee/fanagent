# FanAgent

React + Supabase scaffold for turning an uploaded audio reference into scheduled TikTok posts.

## Stack

- Vite, React, TypeScript
- Tailwind CSS v4 and shadcn/ui components
- Supabase Postgres, Storage, Edge Functions, and Cron
- FullCalendar for schedule review and drag-to-reschedule

## Local Development

```bash
npm install
npm run dev
```

The frontend reads the checked-in Supabase project URL and publishable key from `src/integrations/supabase/client.ts`. Keep private credentials out of React and set them as Supabase Edge Function secrets.

## Supabase Secrets

Set these in the Supabase dashboard or with `supabase secrets set`:

```bash
GMI_API_KEY=...
GMI_ORG_ID=...
GMI_SEEDANCE_MODEL_ID=...
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=...
TOKEN_ENCRYPTION_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SITE_URL=...
REMOTE_RENDER_API_URL=...
REMOTE_RENDER_API_KEY=...
```

`REMOTE_RENDER_*` is optional and only needed when using the `remote_render` source mode. Hosted v1 does not use local ffmpeg.

## Edge Functions

- `create-generation-batch`: registers uploaded audio, batch, and generation item rows before provider calls.
- `process-generation-due`: advances pending GMI or remote-render jobs, stores final MP4s in Supabase Storage, and creates pending posts.
- `publish-tiktok-due`: publishes due posts through TikTok Direct Post and polls in-flight publish IDs.
- `tiktok-oauth-callback`: starts and completes TikTok OAuth.
- `update-post-schedule`: edits scheduled time, caption, hashtags, privacy, and interaction settings.

Deploy functions with the Supabase CLI after linking the project:

```bash
npx supabase functions deploy create-generation-batch
npx supabase functions deploy process-generation-due
npx supabase functions deploy publish-tiktok-due
npx supabase functions deploy tiktok-oauth-callback
npx supabase functions deploy update-post-schedule
```

The migration includes commented Supabase Cron examples for invoking generation and publishing every five minutes after project URL and anon key are stored in Vault.
