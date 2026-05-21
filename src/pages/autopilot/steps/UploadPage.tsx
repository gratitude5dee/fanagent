import { UploadStep } from "@/components/autopilot/UploadStep";
import { useAutopilot } from "../useAutopilot";

export default function UploadPage() {
  const ctx = useAutopilot();
  return (
    <div className="autopilot-focused-step">
      <UploadStep
        audioFile={ctx.audioFile}
        duration={ctx.duration}
        isConnected={ctx.isConnected}
        schemaReady={ctx.schemaReady}
        trimmedAudio={ctx.trimmedAudio}
        audioClipStatus={ctx.audioClipStatus}
        audioClipError={ctx.audioClipError}
        registeredAudioClipId={ctx.registeredAudioClip?.id ?? null}
        templateProvidesAudio={
          !!ctx.selectedTemplate?.audio_clip_id &&
          !!ctx.selectedTemplate?.trimmed_audio_asset_id &&
          ctx.selectedTemplate.status === "saved"
        }
        onAudioFile={ctx.setAudioFile}
        onDuration={ctx.setDuration}
        onTrimmedAudio={ctx.setTrimmedAudio}
      />
    </div>
  );
}
