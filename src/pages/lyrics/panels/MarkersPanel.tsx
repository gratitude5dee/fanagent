import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Redo2, RotateCcw, Scissors, Trash2, Undo2 } from "lucide-react";
import { addMarker, deleteAt, moveMarker, UndoStack } from "@/lib/lyrics/markers";
import type { LyricBlock, LyricTemplate, LyricWord } from "@/lib/lyrics/types";
import type { AudioEngine } from "@/lib/lyrics/useAudioEngine";

type Props = {
  active: boolean;
  template: LyricTemplate | null;
  engine: AudioEngine;
  onChange: (markers: number[]) => void;
};

export default function MarkersPanel({ active, template, engine, onChange }: Props) {
  const [markers, setMarkers] = useState<number[]>(() =>
    (template?.cut_markers ?? []).map((m) => m / 1000),
  );
  const [zoom, setZoom] = useState(1);
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
  const time = engine.currentTime;

  useEffect(() => {
    const next = (template?.cut_markers ?? []).map((m) => m / 1000);
    setMarkers((prev) => {
      if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev;
      return next;
    });
  }, [template?.id, template?.cut_markers]);

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
    void engine.toggle();
  }, [engine]);

  const restart = useCallback(() => {
    const wasPlaying = engine.isPlaying;
    engine.seek(0);
    if (wasPlaying) void engine.play();
  }, [engine]);

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

  const activeBlock: LyricBlock | null = useMemo(() => {
    for (const b of blocks) {
      if (time >= b.startTime && time <= b.endTime) return b;
      for (const w of b.words) {
        if (time >= w.startTime && time <= w.endTime) return b;
      }
    }
    return null;
  }, [blocks, time]);

  const activeWord: LyricWord | null = useMemo(() => {
    if (!activeBlock) return null;
    for (const w of activeBlock.words) {
      if (time >= w.startTime && time <= w.endTime) return w;
    }
    return null;
  }, [activeBlock, time]);

  const lineWords = activeBlock?.words ?? [];
  const idxInLine = activeWord ? lineWords.findIndex((w) => w.id === activeWord.id) : -1;
  const prevWord = idxInLine > 0 ? lineWords[idxInLine - 1] : null;
  const nextWord =
    idxInLine >= 0 && idxInLine < lineWords.length - 1 ? lineWords[idxInLine + 1] : null;

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
      <div className="lyr-stage">
        {flashCut ? <span className="lyr-cut-flash">CUT</span> : null}
        {lineWords.length > 0 ? (
          <div className="lyr-karaoke-line">
            {lineWords.map((w) => {
              const cls =
                time > w.endTime
                  ? "past"
                  : time < w.startTime
                  ? "upcoming"
                  : "active";
              return (
                <span key={w.id} className={`word ${cls}`}>
                  {w.text}
                </span>
              );
            })}
          </div>
        ) : (
          <span className="lyr-stage-word">—</span>
        )}
      </div>

      <div className="lyr-caption-ribbon">
        <span className="prev">{prevWord?.text ?? ""}</span>
        <span className="cur">{activeWord?.text ?? "—"}</span>
        <span className="next">{nextWord?.text ?? ""}</span>
      </div>

      <div className="lyr-controls">
        <button className="lyr-btn" onClick={togglePlay} disabled={!engine.isReady}>
          {engine.isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className="lyr-btn" onClick={restart} disabled={!engine.isReady}>
          <RotateCcw size={14} />
        </button>
        <span className="lyr-tag">
          {time.toFixed(2)}s / {duration.toFixed(0)}s
          {!engine.isReady ? " · loading…" : ""}
        </span>
        <div
          className="lyr-progress clickable"
          onClick={(e) => engine.seek(pointerToTime(e.clientX))}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) engine.seek(pointerToTime(e.clientX));
          }}
        >
          <span style={{ width: `${duration > 0 ? (time / duration) * 100 : 0}%` }} />
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
          <div
            className="lyr-playhead"
            style={{ left: `${duration > 0 ? (time / duration) * 100 : 0}%` }}
          />
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
                  undoRef.current.push(markers);
                  commit(markers);
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
