// Audio waveform + trim UI for the Autopilot wizard's Step 1.
// Uses wavesurfer.js for the dark-card waveform and Web Audio to render
// the trimmed slice as a WAV Blob the parent uploads to Supabase Storage.

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.js";
import { ChevronsLeft, ChevronsRight, Loader2, Music, Pause, Play, Scissors } from "lucide-react";
import { trimAudio } from "@/lib/audio/ffmpeg";
import { clampFixedDurationRegion, clipSelectionMatchesDuration } from "@/lib/audio/selection";

type Props = {
  file: File;
  maxDurationSec: number;
  onTrimmed: (
    blob: Blob,
    selection: {
      startSec: number;
      endSec: number;
      durationSec: number;
      originalFileName: string;
    },
  ) => void;
};

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AudioTrimmer({ file, maxDurationSec, onTrimmed }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const regionRef = useRef<Region | null>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [region, setRegion] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const url = URL.createObjectURL(file);

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "rgba(255,255,255,0.35)",
      progressColor: "rgb(56, 189, 248)",
      cursorColor: "rgb(56, 189, 248)",
      cursorWidth: 2,
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      height: 140,
      normalize: true,
      plugins: [regions],
    });
    wsRef.current = ws;

    // ws.load returns a promise that rejects with AbortError when destroyed mid-fetch.
    ws.load(url).catch((err: unknown) => {
      if (cancelled) return;
      const name = (err as { name?: string } | null)?.name;
      if (name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    });

    ws.on("ready", () => {
      if (cancelled || wsRef.current !== ws || !regionsRef.current) return;
      const d = ws.getDuration();
      setDuration(d);
      const fixedRegion = clampFixedDurationRegion({
        audioDurationSec: d,
        startSec: 0,
        targetDurationSec: maxDurationSec,
      });
      const r = regions.addRegion({
        start: fixedRegion.startSec,
        end: fixedRegion.endSec,
        color: "rgba(56,189,248,0.18)",
        drag: true,
        resize: true,
      });
      regionRef.current = r;
      setRegion({ start: fixedRegion.startSec, end: fixedRegion.endSec });

      r.on("update", () => {
        const next = clampFixedDurationRegion({
          audioDurationSec: d,
          startSec: r.start,
          targetDurationSec: maxDurationSec,
        });
        if (Math.abs(next.startSec - r.start) > 0.01 || Math.abs(next.endSec - r.end) > 0.01) {
          r.setOptions({ start: next.startSec, end: next.endSec });
        }
        setRegion({ start: next.startSec, end: next.endSec });
      });
    });

    ws.on("audioprocess", (t) => setCurrentTime(t));
    ws.on("seeking", (t) => setCurrentTime(t));
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));

    // Loop within the selected region.
    ws.on("timeupdate", (t) => {
      const r = regionRef.current;
      if (!r) return;
      if (ws.isPlaying() && t >= r.end) {
        ws.setTime(r.start);
      }
    });

    return () => {
      cancelled = true;
      try {
        ws.destroy();
      } catch {
        // wavesurfer aborts the in-flight fetch via AbortController; ignore.
      }
      wsRef.current = null;
      regionsRef.current = null;
      regionRef.current = null;
      URL.revokeObjectURL(url);
    };
  }, [file, maxDurationSec]);

  function togglePlay() {
    const ws = wsRef.current;
    const r = regionRef.current;
    if (!ws || !r) return;
    if (ws.isPlaying()) {
      ws.pause();
    } else {
      const t = ws.getCurrentTime();
      if (t < r.start || t >= r.end) ws.setTime(r.start);
      ws.play();
    }
  }

  function skip(deltaSec: number) {
    const ws = wsRef.current;
    const r = regionRef.current;
    if (!ws || !r) return;
    const next = Math.min(r.end - 0.1, Math.max(r.start, ws.getCurrentTime() + deltaSec));
    ws.setTime(next);
  }

  async function useClip() {
    setBusy(true);
    setError(null);
    try {
      if (
        !clipSelectionMatchesDuration(
          { startSec: region.start, endSec: region.end },
          maxDurationSec,
        )
      ) {
        throw new Error(`Select exactly ${maxDurationSec}s of audio before confirming.`);
      }
      const blob = await trimAudio(file, region.start, region.end);
      onTrimmed(blob, {
        startSec: region.start,
        endSec: region.end,
        durationSec: region.end - region.start,
        originalFileName: file.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const selLen = region.end - region.start;
  const tooShort = duration > 0 && duration + 0.05 < maxDurationSec;
  const selectionReady =
    !tooShort &&
    clipSelectionMatchesDuration({ startSec: region.start, endSec: region.end }, maxDurationSec);

  return (
    <div className="audio-trimmer">
      <div className="audio-trimmer__label">
        <Music size={14} /> Audio
      </div>
      <div className="audio-trimmer__card">
        <div ref={containerRef} className="audio-trimmer__wave" />
        <div className="audio-trimmer__controls">
          <button
            type="button"
            className="button ghost"
            onClick={() => skip(-5)}
            aria-label="Back 5s"
          >
            <ChevronsLeft size={18} />
          </button>
          <button
            type="button"
            className="button primary round"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => skip(5)}
            aria-label="Forward 5s"
          >
            <ChevronsRight size={18} />
          </button>
          <span className="audio-trimmer__time">
            {fmt(currentTime)} / {fmt(duration)}
          </span>
        </div>
      </div>
      <div className="audio-trimmer__footer">
        <div>
          Selected:{" "}
          <strong>
            {fmt(region.start)} → {fmt(region.end)}
          </strong>{" "}
          <span className="muted">
            ({selLen.toFixed(1)}s of {maxDurationSec}s)
          </span>
        </div>
        <button
          type="button"
          className="button primary"
          disabled={busy || tooShort || !selectionReady}
          onClick={useClip}
        >
          {busy ? <Loader2 size={16} className="spin" /> : <Scissors size={16} />} Use this clip
        </button>
      </div>
      {tooShort ? (
        <div className="banner warn">
          Audio is only {duration.toFixed(1)}s — shorter than the {maxDurationSec}s post duration.
          Pick a longer file or a shorter post duration.
        </div>
      ) : null}
      {error ? <div className="banner bad">{error}</div> : null}
    </div>
  );
}
