import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Music, Pause, Play, UploadCloud } from "lucide-react";
import { decodePeaks, fallbackPeaks, sliceToWav, validateAudioFile } from "@/lib/lyrics/audio";
import { lyricsApi, secToMs, uploadToBucket } from "@/lib/lyrics/api";
import type { ClipDuration, LyricTemplate } from "@/lib/lyrics/types";
import type { AudioEngine } from "@/lib/lyrics/useAudioEngine";
import { supabase } from "@/integrations/supabase/client";

const DURATIONS: ClipDuration[] = [15, 30, 45, 60];

type Props = {
  existing: LyricTemplate | null;
  engine: AudioEngine;
  hasTrimmedAudio: boolean;
  onPreviewUrl: (url: string | null) => void;
  onConfirmed: (out: { template: LyricTemplate }) => void;
  onError: (msg: string) => void;
};

export default function AudioPanel({
  existing,
  engine,
  hasTrimmedAudio,
  onPreviewUrl,
  onConfirmed,
  onError,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<ClipDuration>(15);
  const [start, setStart] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const dragRef = useRef<{ pointer: number; start: number } | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const confirmed = !!existing?.trimmed_audio_asset_id;

  // Restore peaks / selection metadata from a resumed template.
  useEffect(() => {
    if (existing && existing.waveform_peaks?.length) {
      setPeaks(existing.waveform_peaks);
      setTotal((existing.total_duration_ms || existing.selection_duration_ms) / 1000);
      setStart(existing.selection_start_ms / 1000);
      const d = (existing.selection_duration_ms / 1000) as ClipDuration;
      if (DURATIONS.includes(d)) setDuration(d);
    }
  }, [existing]);

  // Update engine loop window when the user adjusts selection (only while we
  // have a raw file preview; once confirmed the parent drives the loop).
  useEffect(() => {
    if (!hasTrimmedAudio && file) {
      engine.setLoop(start, start + duration, { loop: true });
    }
  }, [start, duration, file, hasTrimmedAudio, engine]);

  // Release blob URLs on unmount / new file.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  async function handleFile(f: File) {
    const err = validateAudioFile(f);
    if (err) {
      onError(err);
      return;
    }
    setFile(f);
    setBusy(true);
    try {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(f);
      blobUrlRef.current = url;
      onPreviewUrl(url);
      try {
        const { peaks: p, durationSec } = await decodePeaks(f);
        setPeaks(p);
        setTotal(durationSec);
      } catch {
        setPeaks(fallbackPeaks(f.name));
        setTotal(60);
      }
      setStart(0);
    } finally {
      setBusy(false);
    }
  }

  function pointerToTime(clientX: number): number {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(total, ratio * total));
  }

  function onSelectionDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { pointer: e.clientX, start };
  }
  function onSelectionMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const t = pointerToTime(e.clientX);
    const next = Math.max(0, Math.min(total - duration, t - duration / 2));
    setStart(next);
  }
  function onSelectionUp() {
    dragRef.current = null;
  }

  async function confirm() {
    if (!file) {
      onError("Pick an audio file first.");
      return;
    }
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) {
      onError("You must be signed in to save a lyric template.");
      return;
    }
    setBusy(true);
    try {
      const trimmed = await sliceToWav(file, start, start + duration);
      const { template } = await lyricsApi.create({
        title: file.name.replace(/\.[^.]+$/, ""),
        selectionStartMs: secToMs(start),
        selectionDurationMs: secToMs(duration),
        totalDurationMs: secToMs(total),
        waveformPeaks: peaks,
      });
      const path = `lyric-templates/${userId}/${template.id}/clip-${Date.now()}.wav`;
      await uploadToBucket("audio-uploads", path, trimmed, "audio/wav");
      const reg = await lyricsApi.registerAudio({
        storagePath: path,
        mimeType: "audio/wav",
        fileName: `${template.id}.wav`,
        byteSize: trimmed.size,
        durationMs: secToMs(duration),
        kind: "audio_trimmed",
      });
      const patched = await lyricsApi.patch(template.id, {
        trimmed_audio_asset_id: reg.id,
        status: "audio_ready",
      });
      onConfirmed({ template: patched.template });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const display = useMemo(
    () => (peaks.length ? peaks : fallbackPeaks("preview")),
    [peaks],
  );

  const selLeft = total > 0 ? `${(start / total) * 100}%` : "0%";
  const selWidth = total > 0 ? `${(duration / total) * 100}%` : "0%";
  const hasAnyAudio = !!file || hasTrimmedAudio;

  return (
    <div className="lyr-audio">
      {!hasAnyAudio ? (
        <label className="lyr-drop">
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            hidden
          />
          <UploadCloud size={28} />
          <strong>Drop or click to upload</strong>
          <small>MP3, WAV, M4A, MP4, AAC, FLAC, OGG · 50MB max</small>
        </label>
      ) : null}

      {hasAnyAudio ? (
        <div
          className="lyr-wave-card"
          style={{ transform: `scaleX(${zoom})`, transformOrigin: "left" }}
        >
          <div className="lyr-wave-card__inner" ref={trackRef}>
            <div className="lyr-wave">
              {display.slice(0, 200).map((v, i) => (
                <span key={i} style={{ height: `${Math.max(6, v * 100)}%` }} />
              ))}
            </div>
            <div
              className={`lyr-selection ${confirmed ? "locked" : ""}`}
              style={{ left: selLeft, width: selWidth }}
              onPointerDown={onSelectionDown}
              onPointerMove={onSelectionMove}
              onPointerUp={onSelectionUp}
              role="slider"
              aria-label="Selection window"
            />
          </div>
        </div>
      ) : null}

      {hasAnyAudio ? (
        <>
          <div className="lyr-row">
            <div className="lyr-duration-buttons">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`lyr-btn ${duration === d ? "primary" : ""}`}
                  onClick={() => setDuration(d)}
                  disabled={confirmed}
                >
                  {d}s
                </button>
              ))}
            </div>
            <button
              type="button"
              className="lyr-btn"
              onClick={() => engine.toggle()}
              disabled={!engine.isReady}
            >
              {engine.isPlaying ? <Pause size={14} /> : <Play size={14} />}{" "}
              {engine.isReady ? "Preview" : "Loading…"}
            </button>
          </div>
          <div className="lyr-row">
            <label className="lyr-label">
              <span>Zoom {zoom.toFixed(1)}x</span>
              <input
                type="range"
                min={1}
                max={4}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
            <span className="lyr-tag">
              <Music size={12} /> {file?.name ?? existing?.title}
            </span>
          </div>
          {!confirmed ? (
            <button
              type="button"
              className="lyr-btn primary lg"
              disabled={busy || !file}
              onClick={confirm}
            >
              {busy ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}
              Confirm selection
            </button>
          ) : (
            <div className="lyr-tag" style={{ alignSelf: "flex-start" }}>
              <CheckCircle2 size={14} /> Audio confirmed
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
