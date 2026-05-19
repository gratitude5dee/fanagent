import { useEffect, useMemo, useState } from "react";
import { Loader2, Pause, Pencil, Play, RotateCcw, Type, Wand2 } from "lucide-react";
import type { LyricBlock, LyricTemplate, TranscribeStatus } from "@/lib/lyrics/types";

type Props = {
  template: LyricTemplate | null;
  audioUrl: string | null;
  audioElRef: React.RefObject<HTMLAudioElement | null>;
  onDone: (blocks: LyricBlock[]) => Promise<void>;
  onRetry: () => Promise<void>;
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

export default function LyricsPanel({ template, audioUrl, audioElRef, onDone, onRetry }: Props) {
  const status = statusToTranscribe(template);
  const [blocks, setBlocks] = useState<LyricBlock[]>(template?.lyric_blocks ?? []);
  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setBlocks(template?.lyric_blocks ?? []);
  }, [template?.id, template?.lyric_blocks]);

  useEffect(() => {
    const a = audioElRef.current;
    if (!a) return;
    const t = () => setTime(a.currentTime);
    a.addEventListener("timeupdate", t);
    return () => a.removeEventListener("timeupdate", t);
  }, [audioElRef, audioUrl]);

  function togglePlay() {
    const a = audioElRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  }

  function manualEntry() {
    const block: LyricBlock = {
      id: crypto.randomUUID(),
      label: "Verse",
      startTime: 0,
      endTime: (template?.selection_duration_ms ?? 15000) / 1000,
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
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId
          ? {
              ...b,
              words: b.words.map((w) => (w.id === wordId ? { ...w, text } : w)),
            }
          : b,
      ),
    );
    setEditingWord(null);
  }

  async function done() {
    setBusy(true);
    try {
      await onDone(blocks);
    } finally {
      setBusy(false);
    }
  }

  const totalWords = useMemo(() => blocks.reduce((s, b) => s + b.words.length, 0), [blocks]);
  const activeWordId = useMemo(() => {
    for (const b of blocks) {
      for (const w of b.words) {
        if (time >= w.startTime && time <= w.endTime) return w.id;
      }
    }
    return null;
  }, [blocks, time]);

  const locked = !template?.trimmed_audio_asset_id;

  if (locked) {
    return (
      <div className="lyr-locked">
        <p>Confirm your audio to unlock lyric editing.</p>
      </div>
    );
  }

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
            <button className="lyr-btn" onClick={togglePlay}>
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <span>{time.toFixed(2)}s</span>
            <span className="lyr-tag">
              {totalWords} words · {blocks.length} blocks
            </span>
          </div>
          <div className="lyr-blocks">
            {blocks.map((b) => (
              <div key={b.id} className="lyr-block">
                <header>
                  <Wand2 size={12} /> {b.label}
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
                          if (e.key === "Enter") commitWordEdit(b.id, w.id, draft || w.text);
                          if (e.key === "Escape") setEditingWord(null);
                        }}
                        onBlur={() => commitWordEdit(b.id, w.id, draft || w.text)}
                      />
                    ) : (
                      <button
                        key={w.id}
                        type="button"
                        className={`lyr-word ${active ? "active" : ""}`}
                        onClick={() => {
                          setDraft(w.text);
                          setEditingWord(w.id);
                        }}
                      >
                        {w.text}
                      </button>
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
