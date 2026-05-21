# Unblock "Generate library" when a saved lyric template is preselected

## Problem
Clicking **Generate library** after picking a saved template (e.g. via *Remix*) shows the browser tooltip *"Please select a file"* and blocks the form because the audio `<input type="file" required>` in step 2 still demands an upload — even though the template already carries its own `audio_clip_id` + `trimmed_audio_asset_id` and the edge function `create-generation-batch` accepts `audioClipId` alone (no `clipSelection` required).

A saved template means: 5 cut markers → 6 stock clips edited against the template's existing audio with captions baked from `lyric_blocks`. No re-upload should be needed.

## Fix (frontend only)

### 1. `src/components/autopilot/UploadStep.tsx`
- Add prop `templateProvidesAudio: boolean`.
- Change file input to `required={!trimmedAudio && !templateProvidesAudio}` so HTML5 validation no longer blocks submit when a template already supplies the audio.
- When `templateProvidesAudio && !audioFile`, render a small banner: *"Using audio from the selected lyric template. Upload a file only to replace it."* (keeps the upload control visible but optional).

### 2. `src/components/AutopilotPanel.tsx`
- Compute `templateProvidesAudio = !!selectedTemplate?.audio_clip_id && !!selectedTemplate?.trimmed_audio_asset_id && selectedTemplate.status === "saved"`.
- Pass it to `UploadStep`.
- Audio-clip register effect: already short-circuits when `!trimmedAudio`, so template-only path is fine.
- `campaignHandoff` already produces `ready=true` from the template alone (audioClipId falls back to `templateAudioClipId`; durations match against themselves; `templateMatchesAudio` is true when there is no registered upload). No changes needed there.
- `startCampaign`: already gated on `campaignHandoff.ready`, and only sends `clipSelection` when `trimmedAudio` exists — the edge function derives selection from the stored audio clip otherwise. No changes needed there.

### 3. `src/components/autopilot/CampaignStep.tsx`
- `trimmedAudioReady` is already computed in the panel to be true when the handoff has both `audioClipId` and `trimmedAudioAssetId`, so the "Trim and register audio" warning and disabled state already clear once a saved template is selected. No changes needed.

## Out of scope
- No edge-function or schema changes.
- No changes to marker→clip pairing logic; cut-marker count already drives `requiredShots` for the category pool check.
- Lyrics↔markers live sync from the previous turn is unaffected.

## Files touched
- `src/components/autopilot/UploadStep.tsx`
- `src/components/AutopilotPanel.tsx`
