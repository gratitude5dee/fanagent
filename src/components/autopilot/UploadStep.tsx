import { useState } from "react";
import { UploadCloud } from "lucide-react";
import AudioTrimmer from "@/components/autopilot/AudioTrimmer";
import { AUDIO_ACCEPT, validateAudioUpload } from "@/lib/audio/selection";

const DURATIONS = [15, 30, 45, 60, 75, 90] as const;
export type Duration = (typeof DURATIONS)[number];
export type AudioClipStatus = "idle" | "registering" | "transcribing" | "ready" | "failed";

type TrimmedAudio = {
  blob: Blob;
  durationSec: number;
  name: string;
  startSec: number;
  endSec: number;
  originalFileName: string;
};

type UploadStepProps = {
  audioFile: File | null;
  duration: Duration;
  isConnected: boolean;
  schemaReady: boolean;
  trimmedAudio: TrimmedAudio | null;
  audioClipStatus: AudioClipStatus;
  audioClipError: string | null;
  registeredAudioClipId: string | null;
  templateProvidesAudio?: boolean;
  onAudioFile: (file: File | null) => void;
  onDuration: (duration: Duration) => void;
  onTrimmedAudio: (trimmed: TrimmedAudio | null) => void;
};

export function UploadStep({
  audioFile,
  duration,
  isConnected,
  schemaReady,
  trimmedAudio,
  audioClipStatus,
  audioClipError,
  registeredAudioClipId,
  templateProvidesAudio = false,
  onAudioFile,
  onDuration,
  onTrimmedAudio,
}: UploadStepProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  function handleFile(file: File | null) {
    setUploadError(null);
    if (file) {
      try {
        validateAudioUpload(file);
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : String(error));
        onAudioFile(null);
        onTrimmedAudio(null);
        return;
      }
    }
    onAudioFile(file);
    onTrimmedAudio(null);
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <UploadCloud size={16} />
        <h3>2. Upload audio</h3>
      </div>
      <div className="stack">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const file = e.dataTransfer.files?.[0] ?? null;
            handleFile(file);
          }}
          style={{
            border: `2px dashed ${dragActive ? "hsl(220 90% 56%)" : "rgba(127,127,127,0.35)"}`,
            borderRadius: 10,
            padding: 14,
            background: dragActive ? "rgba(120,140,255,0.06)" : "transparent",
            transition: "background 120ms, border-color 120ms",
            display: "block",
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>
            Audio (MP3/WAV/M4A/AAC/FLAC, max 50 MB) — drag &amp; drop or browse
          </div>
          <input
            type="file"
            accept={AUDIO_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (!file) {
                onAudioFile(null);
                onTrimmedAudio(null);
                return;
              }
              handleFile(file);
              if (uploadError) event.target.value = "";
            }}
            required={!trimmedAudio && !templateProvidesAudio}
          />
        </label>
        <div className="banner">You must have rights to publish this audio.</div>
        {templateProvidesAudio && !audioFile && !trimmedAudio ? (
          <div className="banner">
            Using audio from the selected lyric template. Upload a file only to replace it.
          </div>
        ) : null}
        {uploadError ? <div className="banner bad">{uploadError}</div> : null}
        {audioFile ? (
          <AudioTrimmer
            file={audioFile}
            maxDurationSec={duration}
            onTrimmed={(blob, selection) =>
              onTrimmedAudio({ blob, name: audioFile.name, ...selection })
            }
          />
        ) : null}
        {trimmedAudio ? (
          <div className="banner">
            Trimmed clip ready ({trimmedAudio.startSec.toFixed(1)}s to{" "}
            {trimmedAudio.endSec.toFixed(1)}s, {trimmedAudio.durationSec.toFixed(1)}s).
          </div>
        ) : null}
        {trimmedAudio && audioClipStatus === "registering" ? (
          <div className="banner">Registering this clip in the video library…</div>
        ) : null}
        {trimmedAudio && audioClipStatus === "transcribing" ? (
          <div className="banner">Clip registered. Transcribing lyrics for review…</div>
        ) : null}
        {trimmedAudio && registeredAudioClipId && audioClipStatus === "ready" ? (
          <div className="banner">
            Audio clip registered and transcription is ready ({registeredAudioClipId.slice(0, 8)}).
          </div>
        ) : null}
        {trimmedAudio && audioClipStatus === "ready" && audioClipError ? (
          <div className="banner warn">{audioClipError}</div>
        ) : null}
        {trimmedAudio && registeredAudioClipId && audioClipStatus === "failed" ? (
          <div className="banner warn">
            Audio clip registered, but transcription needs manual review:{" "}
            {audioClipError ?? "Transcription failed."}
          </div>
        ) : null}
        {trimmedAudio && !registeredAudioClipId && audioClipStatus === "failed" ? (
          <div className="banner bad">
            Could not register this audio clip: {audioClipError ?? "Registration failed."}
          </div>
        ) : null}
        {/* Schema readiness banner removed — surfaced in AutopilotPanel diagnostics row. */}

        {!isConnected ? (
          <div className="banner warn">
            TikTok is not connected. Videos can still generate; auto-posting will wait until OAuth
            is connected.
          </div>
        ) : null}
        <label>
          Post duration
          <div className="action-row" style={{ flexWrap: "wrap", gap: 6 }}>
            {DURATIONS.map((value) => (
              <button
                type="button"
                key={value}
                className={`button ${duration === value ? "primary" : "ghost"}`}
                onClick={() => {
                  onDuration(value);
                  onTrimmedAudio(null);
                }}
              >
                {value}s
              </button>
            ))}
          </div>
        </label>
      </div>
    </section>
  );
}
