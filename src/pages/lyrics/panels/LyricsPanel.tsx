import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pause, Pencil, Play, Plus, RotateCcw, Trash2, Type, Wand2, X } from "lucide-react";
import type { LyricBlock, LyricTemplate, TranscribeStatus } from "@/lib/lyrics/types";
import type { AudioEngine } from "@/lib/lyrics/useAudioEngine";

type Props = {
  template: LyricTemplate | null;
  engine: AudioEngine;
  onDone: (blocks: LyricBlock[]) => Promise<void>;
  onRetry: () => Promise<void>;
  onBlocksLive?: (blocks: LyricBlock[]) => void;
};

function statusToTranscribe(t: LyricTemplate | null): TranscribeStatus {
  if (!t) return "idle";
  if (t.status === "draft") return "idle";
  if (t.status === "audio_ready") return "uploading";
  if (t.status === "lyrics_processing") return "transcribing";
  if (t.status === "failed") return "failed";
  if (t.lyric_blocks?.length) return "ready";
  return "idle";
}

const STATUS_LABEL: Record<TranscribeStatus, string> = {
  idle: "Waiting for audio…",
  uploading: "Uploading audio…",
  transcribing: "Transcribing with Gemini 3.1 Flash…",
  parsing: "Aligning lyrics to beats…",
  ready: "Ready",
  failed: "Transcription failed",
};

export default function LyricsPanel({ template, engine, onDone, onRetry }: Props) {
  const status = statusToTranscribe(template);
  const [blocks, setBlocks] = useState<LyricBlock[]>(template?.lyric_blocks ?? []);
  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const wordRefs = useRef<Map<string, HTMLElement>>(new Map());
  const lastScrolledRef = useRef<string | null>(null);

  useEffect(() => {
    setBlocks(template?.lyric_blocks ?? []);
  }, [template?.id, template?.lyric_blocks]);

  const time = engine.currentTime;
  const clipDur = (template?.selection_duration_ms ?? 15000) / 1000;

  function manualEntry() {
    const block: LyricBlock = {
      id: crypto.randomUUID(),
      label: "Verse",
      startTime: 0,
      endTime: clipDur,
      words: [
        {
          id: crypto.randomUUID(),
          text: "type your lyrics here",
          startTime: 0,
          endTime: 1,
        },
      ],
    };
    setBlocks([block]);
  }

  function commitWordEdit(blockId: string, wordId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      deleteWord(blockId, wordId);
      return;
    }
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId
          ? {
              ...b,
              words: b.words.map((w) => (w.id === wordId ? { ...w, text: trimmed } : w)),
            }
          : b,
      ),
    );
    setEditingWord(null);
  }

  function deleteWord(blockId: string, wordId: string) {
    setBlocks((prev) =>
      prev
        .map((b) => (b.id === blockId ? { ...b, words: b.words.filter((w) => w.id !== wordId) } : b))
        .filter((b) => b.words.length > 0),
    );
    setEditingWord(null);
  }

  function addWord(blockId: string) {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== blockId) return b;
        const last = b.words[b.words.length - 1];
        const start = last ? last.endTime : b.startTime;
        const end = Math.min(clipDur, start + 0.4);
        return {
          ...b,
          endTime: Math.max(b.endTime, end),
          words: [
            ...b.words,
            { id: crypto.randomUUID(), text: "word", startTime: start, endTime: end },
          ],
        };
      }),
    );
  }

  function deleteBlock(blockId: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId));
  }

  async function done() {
    setBusy(true);
    try {
      const clean = blocks.filter((b) => b.words.length > 0);
      await onDone(clean);
    } finally {
      setBusy(false);
    }
  }

  const totalWords = useMemo(() => blocks.reduce((s, b) => s + b.words.length, 0), [blocks]);

  const { activeWordId, activeBlockId } = useMemo(() => {
    for (const b of blocks) {
      for (const w of b.words) {
        if (time >= w.startTime && time <= w.endTime) {
          return { activeWordId: w.id, activeBlockId: b.id };
        }
      }
    }
    return { activeWordId: null as string | null, activeBlockId: null as string | null };
  }, [blocks, time]);

  // Auto-scroll active word into view (throttled by id change).
  useEffect(() => {
    if (!activeWordId || activeWordId === lastScrolledRef.current) return;
    lastScrolledRef.current = activeWordId;
    const el = wordRefs.current.get(activeWordId);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    }
  }, [activeWordId]);

  const locked = !template?.trimmed_audio_asset_id;

  if (locked) {
    return (
      <div className="lyr-locked">
        <p>Confirm your audio to unlock lyric editing.</p>
      </div>
    );
  }

  const progressPct = clipDur > 0 ? Math.min(100, (time / clipDur) * 100) : 0;

  return (
    <div className="lyr-lyrics">
      <div className={`lyr-status-row ${status}`}>
        {["uploading", "transcribing", "parsing"].includes(status) ? (
          <Loader2 className="spin" size={14} />
        ) : null}
        <span>{STATUS_LABEL[status]}</span>
      </div>

      {status === "failed" ? (
        <div className="lyr-row">
          <button className="lyr-btn" onClick={() => onRetry()}>
            <RotateCcw size={14} /> Retry
          </button>
          <button className="lyr-btn" onClick={manualEntry}>
            <Type size={14} /> Manual entry
          </button>
        </div>
      ) : null}

      {status !== "ready" && status !== "failed" ? (
        <button className="lyr-btn ghost" onClick={manualEntry}>
          <Type size={14} /> Type lyrics manually instead
        </button>
      ) : null}

      {blocks.length > 0 ? (
        <>
          <div className="lyr-mini-player">
            <button
              className="lyr-btn"
              onClick={() => engine.toggle()}
              title={engine.isPlaying ? "Pause" : "Play"}
            >
              {engine.isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <span>{time.toFixed(2)}s</span>
            <span className="lyr-tag">
              {totalWords} words · {blocks.length} blocks
              {!engine.isReady ? " · loading…" : ""}
            </span>
          </div>
          <div
            className="lyr-progress clickable"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              engine.seek(Math.max(0, Math.min(clipDur, pct * clipDur)));
            }}
          >
            <span style={{ width: `${progressPct}%` }} />
          </div>
          <div className="lyr-blocks">
            {blocks.map((b) => (
              <div
                key={b.id}
                className={`lyr-block ${activeBlockId === b.id ? "active" : ""}`}
              >
                <header>
                  <Wand2 size={12} /> {b.label}
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="lyr-btn ghost xs"
                    onClick={() => addWord(b.id)}
                    title="Add word"
                  >
                    <Plus size={12} /> Word
                  </button>
                  <button
                    type="button"
                    className="lyr-btn ghost xs"
                    onClick={() => deleteBlock(b.id)}
                    title="Delete block"
                  >
                    <Trash2 size={12} />
                  </button>
                </header>
                <div className="lyr-words">
                  {b.words.map((w) => {
                    const isEditing = editingWord === w.id;
                    const active = activeWordId === w.id;
                    return isEditing ? (
                      <input
                        key={w.id}
                        autoFocus
                        className="lyr-word-input"
                        defaultValue={w.text}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitWordEdit(b.id, w.id, draft);
                          if (e.key === "Escape") setEditingWord(null);
                        }}
                        onBlur={() => commitWordEdit(b.id, w.id, draft)}
                      />
                    ) : (
                      <span key={w.id} className={`lyr-word-wrap ${active ? "active" : ""}`}>
                        <button
                          ref={(el) => {
                            if (el) wordRefs.current.set(w.id, el);
                            else wordRefs.current.delete(w.id);
                          }}
                          type="button"
                          className={`lyr-word ${active ? "active" : ""}`}
                          onClick={(e) => {
                            if (e.shiftKey) {
                              engine.seek(w.startTime);
                              return;
                            }
                            setDraft(w.text);
                            setEditingWord(w.id);
                          }}
                          title="Click to edit · Shift+Click to seek · clear text to delete"
                        >
                          {w.text}
                        </button>
                        <button
                          type="button"
                          className="lyr-word-del"
                          onClick={() => deleteWord(b.id, w.id)}
                          title="Delete word"
                          aria-label="Delete word"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <button className="lyr-btn primary lg" onClick={done} disabled={busy || totalWords === 0}>
            {busy ? <Loader2 className="spin" size={14} /> : <Pencil size={14} />} Done — go to
            markers
          </button>
        </>
      ) : null}
    </div>
  );
}
