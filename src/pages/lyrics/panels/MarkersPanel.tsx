import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Redo2, RotateCcw, Scissors, Trash2, Undo2 } from "lucide-react";
import { addMarker, deleteAt, moveMarker, UndoStack } from "@/lib/lyrics/markers";
import type { LyricBlock, LyricTemplate, LyricWord } from "@/lib/lyrics/types";

type Props = {
  active: boolean;
  template: LyricTemplate | null;
  audioUrl: string | null;
  onChange: (markers: number[]) => void;
};

export default function MarkersPanel({ active, template, audioUrl, onChange }: Props) {
  const [markers, setMarkers] = useState<number[]>(() =>
    (template?.cut_markers ?? []).map((m) => m / 1000),
  );
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const undoRef = useRef(new UndoStack<number[]>());
  const dragRef = useRef<{ idx: number } | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const duration = (template?.selection_duration_ms ?? 15000) / 1000;
  const peaks = template?.waveform_peaks ?? [];
  const blocks = (template?.lyric_blocks ?? []) as LyricBlock[];

  // Sync local markers from server template only when the incoming list
  // actually differs. Avoids a setState/onChange/parent-patch loop.
  useEffect(() => {
    const next = (template?.cut_markers ?? []).map((m) => m / 1000);
    setMarkers((prev) => {
      if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev;
      return next;
    });
  }, [template?.id, template?.cut_markers]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const t = () => setTime(a.currentTime);
    a.addEventListener("timeupdate", t);
    return () => a.removeEventListener("timeupdate", t);
  }, [audioUrl]);

  // Commit user-driven changes to parent. Marker list is small, so a content
  // diff is fine and breaks the render loop when parent re-emits an equivalent
  // template after persisting.
  const commit = useCallback((next: number[]) => {
    onChangeRef.current(next.map((m) => Math.round(m * 1000)));
  }, []);

  const update = useCallback(
    (next: number[]) => {
      undoRef.current.push(markers);
      setMarkers(next);
      commit(next);
    },
    [markers, commit],
  );

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  }, []);

  const restart = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    setTime(0);
  }, []);

  const addAtCurrent = useCallback(() => {
    update(addMarker(markers, time));
  }, [markers, time, update]);

  const deleteNearest = useCallback(() => {
    update(deleteAt(markers, time));
  }, [markers, time, update]);

  const undo = useCallback(() => {
    const prev = undoRef.current.undo(markers);
    if (prev) {
      setMarkers(prev);
      commit(prev);
    }
  }, [markers, commit]);

  const redo = useCallback(() => {
    const next = undoRef.current.redo(markers);
    if (next) {
      setMarkers(next);
      commit(next);
    }
  }, [markers, commit]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        addAtCurrent();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteNearest();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, togglePlay, addAtCurrent, undo, redo, deleteNearest]);

  const activeWord: LyricWord | null = useMemo(() => {
    for (const b of blocks) {
      for (const w of b.words) {
        if (time >= w.startTime && time <= w.endTime) return w;
      }
    }
    return null;
  }, [blocks, time]);

  const allWords = useMemo<LyricWord[]>(() => blocks.flatMap((b) => b.words), [blocks]);
  const idx = activeWord ? allWords.findIndex((w) => w.id === activeWord.id) : -1;
  const prevWord = idx > 0 ? allWords[idx - 1] : null;
  const nextWord = idx >= 0 && idx < allWords.length - 1 ? allWords[idx + 1] : null;

  const flashCut = markers.some((m) => Math.abs(m - time) < 0.18);

  function pointerToTime(clientX: number): number {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  }

  const locked = !template?.trimmed_audio_asset_id || blocks.length === 0;
  if (locked) {
    return (
      <div className="lyr-locked">
        <p>Finish lyrics to unlock cut markers.</p>
      </div>
    );
  }

  return (
    <div className="lyr-markers">
      {audioUrl ? <audio ref={audioRef} src={audioUrl} preload="metadata" /> : null}

      <div className="lyr-stage">
        {flashCut ? <span className="lyr-cut-flash">CUT</span> : null}
        {activeWord ? (
          <span className="lyr-stage-word">{activeWord.text.toUpperCase()}</span>
        ) : null}
      </div>

      <div className="lyr-caption-ribbon">
        <span className="prev">{prevWord?.text ?? ""}</span>
        <span className="cur">{activeWord?.text ?? "—"}</span>
        <span className="next">{nextWord?.text ?? ""}</span>
      </div>

      <div className="lyr-controls">
        <button className="lyr-btn" onClick={togglePlay}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className="lyr-btn" onClick={restart}>
          <RotateCcw size={14} />
        </button>
        <span className="lyr-tag">
          {time.toFixed(2)}s / {duration.toFixed(0)}s
        </span>
        <div className="lyr-progress">
          <span style={{ width: `${(time / duration) * 100}%` }} />
        </div>
      </div>

      <div
        className="lyr-marker-track"
        style={{ transform: `scaleX(${zoom})`, transformOrigin: "left" }}
      >
        <div className="lyr-marker-track__inner" ref={trackRef}>
          <div className="lyr-wave thin">
            {(peaks.length
              ? peaks
              : Array.from({ length: 80 }, (_, i) => Math.abs(Math.sin(i * 0.4)) * 0.6 + 0.2)
            )
              .slice(0, 200)
              .map((v, i) => (
                <span key={i} style={{ height: `${Math.max(8, v * 100)}%` }} />
              ))}
          </div>
          <div className="lyr-playhead" style={{ left: `${(time / duration) * 100}%` }} />
          {markers.map((m, i) => (
            <button
              key={i}
              className="lyr-marker"
              style={{ left: `${(m / duration) * 100}%` }}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture(e.pointerId);
                dragRef.current = { idx: i };
              }}
              onPointerMove={(e) => {
                if (dragRef.current?.idx === i) {
                  setMarkers((prev) => moveMarker(prev, i, pointerToTime(e.clientX)));
                }
              }}
              onPointerUp={() => {
                if (dragRef.current?.idx === i) {
                  dragRef.current = null;
                  // commit through update path so undo captures it
                  undoRef.current.push(markers);
                }
              }}
              onClick={(e) => {
                e.preventDefault();
                update(markers.filter((_, j) => j !== i));
              }}
              title={`${m.toFixed(2)}s — click to delete`}
            />
          ))}
        </div>
      </div>

      <div className="lyr-row">
        <button className="lyr-btn" onClick={addAtCurrent}>
          <Scissors size={14} /> Add (M)
        </button>
        <button className="lyr-btn" onClick={undo} disabled={!undoRef.current.canUndo}>
          <Undo2 size={14} />
        </button>
        <button className="lyr-btn" onClick={redo} disabled={!undoRef.current.canRedo}>
          <Redo2 size={14} />
        </button>
        <button className="lyr-btn" onClick={deleteNearest}>
          <Trash2 size={14} />
        </button>
        <span className="lyr-tag">{markers.length} cuts</span>
        <button className="lyr-btn ghost" onClick={() => update([])}>
          Clear
        </button>
        <label className="lyr-label inline">
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
      </div>
    </div>
  );
}
