import type { RegisteredAudioClipSummary } from "@/lib/fanagent/audioClip";
import type { LyricTemplateSummary } from "@/lib/lyrics/types";
import type { CampaignHandoff, TrimmedAudio } from "./AutopilotContext";

export function buildCampaignHandoff(input: {
  lyricTemplateId: string;
  registeredAudioClip: RegisteredAudioClipSummary | null;
  selectedTemplate: LyricTemplateSummary | null;
  trimmedAudio: TrimmedAudio | null;
}): CampaignHandoff {
  const templateAudioClipId = input.selectedTemplate?.audio_clip_id ?? null;
  const audioClipId = input.registeredAudioClip?.id ?? templateAudioClipId ?? null;
  const templateSaved = input.selectedTemplate?.status === "saved";
  const templateMatchesAudio =
    !!templateAudioClipId &&
    (!input.registeredAudioClip || templateAudioClipId === input.registeredAudioClip.id);
  const templateDurationSec = input.selectedTemplate
    ? Math.round(Number(input.selectedTemplate.selection_duration_ms ?? 0) / 1000)
    : null;
  const audioDurationSec =
    input.registeredAudioClip?.duration_sec ??
    input.trimmedAudio?.durationSec ??
    templateDurationSec;
  const durationMatches =
    templateDurationSec != null &&
    audioDurationSec != null &&
    Math.abs(templateDurationSec - audioDurationSec) <= 0.05;

  return {
    audioClipId,
    lyricTemplateId: input.lyricTemplateId || null,
    templateStatus: input.selectedTemplate?.status ?? null,
    durationSec: audioDurationSec,
    clipSelection: input.trimmedAudio
      ? {
          startSec: input.trimmedAudio.startSec,
          endSec: input.trimmedAudio.endSec,
          durationSec: input.trimmedAudio.durationSec,
          originalFileName: input.trimmedAudio.originalFileName,
        }
      : null,
    trimmedAudioAssetId: input.selectedTemplate?.trimmed_audio_asset_id ?? null,
    templateAudioClipId,
    templateSaved,
    templateMatchesAudio,
    ready:
      !!audioClipId &&
      !!input.selectedTemplate?.trimmed_audio_asset_id &&
      templateSaved &&
      templateMatchesAudio &&
      durationMatches,
  };
}
