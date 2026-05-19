# FanAgent

React + Supabase scaffold for turning an uploaded audio reference into scheduled TikTok posts.

## FanAgent v2

FanAgent v2 turns one trimmed audio clip into a reusable library of finalized lyric videos before anything is scheduled. The create flow is now:

1. Connect or reconnect TikTok. Generation can continue while publishing is blocked.
2. Upload audio, trim one 15/30/45/60/75/90 second clip, and review the lyric template.
3. Generate a video library with stock, library, Seedance, GMI Seedance, sports-edit, or streamer-clip sources.
4. Review finalized videos at `/library` or `/library/:audioClipId`, including provenance, duration, reuse flags, regenerate, and segment replacement.
5. Schedule ready library items from `/calendar` with drag/drop or bulk cadence/window tools, including optional jitter to avoid robotic posting times.
6. Let `fanpage-publish-due` publish due posts through TikTok Direct Post.

Publishing failures are isolated from generation. Posts stay `pending` with actionable `publish_status` values such as `blocked_account_not_connected`, `blocked_missing_privacy`, `blocked_creator_restriction`, `blocked_missing_video`, or `retry_scheduled`; the library item remains intact.

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
YOUTUBE_API_KEY=...
SPORTS_EDITS_ALLOWED_CHANNELS=UC...,@owned-sports-channel
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
STREAMER_CLIP_ALLOWED_CHANNELS=creator_login,another_creator
SUPABASE_SERVICE_ROLE_KEY=...
SITE_URL=...
```

Stock generation can run with either `PEXELS_API_KEY` or `PIXABAY_API_KEY`; both improves coverage. `FAL_KEY` is required for Seedance segments and ffmpeg-based audio/video composition. `GMI_*`, `ELEVENLABS_API_KEY`, and `LOVABLE_API_KEY` are optional feature enrichments surfaced by the dashboard preflight panel.

Sports and streamer adapters are disabled until their official API credentials and allowlists are set. `sports_edit` uses YouTube Data API metadata from allowed owned or licensed channels, but rendering requires owner-provided MP4 asset URLs; public YouTube watch URLs are provenance only. `streamer_clip` uses Twitch Helix clips for explicitly allowed creators and stores creator attribution in source provenance.

## Edge Functions

- `create-generation-batch`: registers uploaded audio, batch, and generation item rows before provider calls.
- `audio-clip-register` and `audio-clip-transcribe`: create the user-facing audio clip and transcription state.
- `source-candidate-search` and `source-candidate-replace`: search/cache adapter candidates and replace one segment.
- `library-finalize`, `library-schedule`, and `library-bulk-schedule`: materialize finalized library items and calendar posts.
- `fanpage-generate-due`: claims due queue rows, handles stock/fal/GMI generation, stores durable final MP4s in Supabase Storage, and finalizes `video_library_items`.
- `publish-tiktok-due`: publishes due posts through TikTok Direct Post and polls in-flight publish IDs.
- `tiktok-oauth-callback`: starts and completes TikTok OAuth.
- `update-post-schedule`: edits scheduled time, caption, hashtags, privacy, and interaction settings.

Deploy functions with the Supabase CLI after linking the project:

```bash
npx supabase functions deploy create-generation-batch
npx supabase functions deploy audio-clip-register
npx supabase functions deploy audio-clip-transcribe
npx supabase functions deploy fanpage-campaign
npx supabase functions deploy fanpage-generate-due
npx supabase functions deploy pick-stock-clip
npx supabase functions deploy source-candidate-search
npx supabase functions deploy source-candidate-replace
npx supabase functions deploy generate-seedance-clip
npx supabase functions deploy stitch-segments
npx supabase functions deploy render-karaoke
npx supabase functions deploy library-finalize
npx supabase functions deploy library-schedule
npx supabase functions deploy library-bulk-schedule
npx supabase functions deploy publish-tiktok-due
npx supabase functions deploy fanpage-publish-due
npx supabase functions deploy tiktok-oauth-callback
npx supabase functions deploy update-post-schedule
```

The latest migration includes commented Supabase Cron examples for invoking `fanpage-generate-due` and `fanpage-publish-due` every five minutes with an `x-cron-secret` stored in Vault.
