import { UploadCloud } from "lucide-react";
import AudioTrimmer from "@/components/autopilot/AudioTrimmer";

const DURATIONS = [15, 30, 45, 60, 75, 90] as const;
export type Duration = (typeof DURATIONS)[number];

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
  onAudioFile,
  onDuration,
  onTrimmedAudio,
}: UploadStepProps) {
  return (
    <section className="panel">
      <div className="panel-title">
        <UploadCloud size={16} />
        <h3>2. Upload audio</h3>
      </div>
      <div className="stack">
        <label>
          Audio (MP3/WAV/M4A)
          <input
            type="file"
            accept="audio/*"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              onAudioFile(file);
              onTrimmedAudio(null);
            }}
            required={!trimmedAudio}
          />
        </label>
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
        {!schemaReady ? (
          <div className="banner bad">
            Database queue schema is not ready. Generation is blocked until the live migration is
            applied.
          </div>
        ) : null}
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
