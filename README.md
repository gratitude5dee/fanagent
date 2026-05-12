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

Open the local app at `http://127.0.0.1:5173/`.

Console messages from `chrome-extension://...`, Lovable Add-ons, Firestore/Firebase, RudderStack, Facebook Pixel, or LinkedIn pixels are emitted by the browser/preview shell or blocked analytics scripts, not by FanAgent. Verify app errors against scripts served from `127.0.0.1:5173`.

The frontend reads the checked-in Supabase project URL and publishable key from `src/integrations/supabase/client.ts`. Keep private credentials out of React and set them as Supabase Edge Function secrets.

## Supabase Secrets

Set these in the Supabase dashboard or with `supabase secrets set`:

```bash
FAL_KEY=...
PEXELS_API_KEY=...
PIXABAY_API_KEY=...
GMI_API_KEY=...
GMI_ORG_ID=...
GMI_SEEDANCE_MODEL_ID=...
ELEVENLABS_API_KEY=...
LOVABLE_API_KEY=...
CRON_SECRET=...
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=...
TOKEN_ENCRYPTION_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SITE_URL=...
```

Stock generation can run with either `PEXELS_API_KEY` or `PIXABAY_API_KEY`; both improves coverage. `FAL_KEY` is required for Seedance segments and ffmpeg-based audio/video composition. `GMI_*`, `ELEVENLABS_API_KEY`, and `LOVABLE_API_KEY` are optional feature enrichments surfaced by the dashboard preflight panel.

## Edge Functions

- `create-generation-batch`: registers uploaded audio, batch, and generation item rows before provider calls.
- `fanpage-generate-due`: claims due queue rows, handles stock/fal/GMI generation, stores durable final MP4s in Supabase Storage, and creates pending posts.
- `publish-tiktok-due`: publishes due posts through TikTok Direct Post and polls in-flight publish IDs.
- `tiktok-oauth-callback`: starts and completes TikTok OAuth.
- `update-post-schedule`: edits scheduled time, caption, hashtags, privacy, and interaction settings.

Deploy functions with the Supabase CLI after linking the project:

```bash
npx supabase functions deploy create-generation-batch
npx supabase functions deploy fanpage-campaign
npx supabase functions deploy fanpage-generate-due
npx supabase functions deploy pick-stock-clip
npx supabase functions deploy generate-seedance-clip
npx supabase functions deploy stitch-segments
npx supabase functions deploy render-karaoke
npx supabase functions deploy publish-tiktok-due
npx supabase functions deploy fanpage-publish-due
npx supabase functions deploy tiktok-oauth-callback
npx supabase functions deploy update-post-schedule
```

The latest migration includes commented Supabase Cron examples for invoking `fanpage-generate-due` and `fanpage-publish-due` every five minutes with an `x-cron-secret` stored in Vault.
