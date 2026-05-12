// Fanpage Autopilot — one-time setup wizard + queue view.
// Wraps the fanpage-campaign edge function. No router required; rendered as a
// top-level mode in App.tsx.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CheckCircle2, FileMusic, Info, Loader2, PauseCircle, Plus, PlayCircle, PlugZap, RefreshCcw, RotateCcw, Sparkles, UploadCloud } from "lucide-react";
import { SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import AudioTrimmer from "@/components/autopilot/AudioTrimmer";
import type { LyricTemplateSummary } from "@/lib/lyrics/types";

type Account = {
  id: string;
  handle: string | null;
  status: string | null;
  is_primary?: boolean;
  tiktok_connected_at: string | null;
  tiktok_display_name: string | null;
};

type Batch = {
  id: string;
  source_mode: string;
  status: string;
  post_count: number;
  cadence_minutes: number;
  paused_at: string | null;
  created_at: string;
  lyric_template_id?: string | null;
};

type Item = {
  id: string;
  batch_id: string;
  status: string;
  scheduled_at: string;
  stock_clip_url: string | null;
  render_provider: string | null;
  error_message: string | null;
  lyric_template_id?: string | null;
};

type Post = {
  id: string;
  generation_item_id: string | null;
  caption: string;
  status: string;
  publish_status: string | null;
  scheduled_at: string;
  video_url: string | null;
};

type CampaignList = {
  account: Account | null;
  batches: Batch[];
  items: Item[];
  posts: Post[];
  lyricTemplates?: LyricTemplateSummary[];
};

type SourceMode = "stock" | "seedance" | "mixed";
const DURATIONS = [15, 30, 45, 60, 75, 90] as const;
type Duration = typeof DURATIONS[number];

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function callCampaign<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("fanpage-campaign", {
    body: { action, ...(body ?? {}) },
  });
  if (error) throw new Error(error.message);
  return data as T;
}

function tiktokConnectUrl(accountId: string): string {
  return `${SUPABASE_URL}/functions/v1/tiktok-oauth-callback?action=connect&accountId=${encodeURIComponent(accountId)}`;
}

function statusTone(status: string): string {
  if (["ready", "complete", "posted"].includes(status)) return "good";
  if (["failed", "skipped"].includes(status)) return "bad";
  if (["transcribing", "picking_stock", "rendering", "generating", "posting"].includes(status)) {
    return "warn";
  }
  return "idle";
}

export default function AutopilotPanel() {
  const [data, setData] = useState<CampaignList | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [trimmedAudio, setTrimmedAudio] = useState<{ blob: Blob; durationSec: number; name: string } | null>(null);
  const [duration, setDuration] = useState<Duration>(15);
  const [sourceMode, setSourceMode] = useState<SourceMode>("stock");
  const [postCount, setPostCount] = useState(14);
  const [prompt, setPrompt] = useState("aesthetic vertical cinematic visuals");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"campaign" | "lyrics">("campaign");
  const [lyricTemplateId, setLyricTemplateId] = useState<string | "">("");

  const lyricTemplates = data?.lyricTemplates ?? [];
  const templateById = useMemo(
    () => new Map(lyricTemplates.map((t) => [t.id, t])),
    [lyricTemplates],
  );

  const account = data?.account ?? null;
  const isConnected = !!account?.tiktok_connected_at;
  const activeBatch = useMemo(
    () => (data?.batches ?? []).find((b) => !b.paused_at && b.status !== "complete") ?? null,
    [data],
  );

  async function refresh() {
    try {
      const next = await callCampaign<CampaignList>("list");
      setData(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, []);

  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await refresh();
      setMessage(`${label} complete.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function startCampaign() {
    if (!trimmedAudio) throw new Error("Trim your audio clip first.");
    if (!account) throw new Error("No account.");
    if (!isConnected) throw new Error("Connect TikTok first.");
    const startAt = new Date(Date.now() + 15 * 60_000).toISOString();
    await callCampaign("create", {
      accountId: account.id,
      audioBase64: await blobToBase64(trimmedAudio.blob),
      audioMimeType: "audio/mpeg",
      audioFileName: trimmedAudio.name.replace(/\.[^.]+$/, "") + ".mp3",
      sourceMode,
      durationSeconds: duration,
      postCount,
      cadenceMinutes: 1440,
      prompt,
      startAt,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lyricTemplateId: lyricTemplateId || null,
    });
  }

  async function setItemTemplate(itemId: string, templateId: string | null) {
    await run("Update template", () =>
      callCampaign("setLyricTemplate", { itemId, lyricTemplateId: templateId }),
    );
  }

  return (
    <div className="autopilot-panel stack">
      <header className="panel-title">
        <Sparkles size={18} />
        <h2>Fanpage Autopilot</h2>
      </header>

      <div className="action-row" role="tablist" aria-label="Autopilot sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "campaign"}
          className={`button ${tab === "campaign" ? "primary" : "ghost"}`}
          onClick={() => setTab("campaign")}
        >
          <CalendarClock size={14} /> Campaign
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "lyrics"}
          className={`button ${tab === "lyrics" ? "primary" : "ghost"}`}
          onClick={() => setTab("lyrics")}
        >
          <FileMusic size={14} /> Lyrics
        </button>
      </div>

      {message ? <div className="banner">{message}</div> : null}

      {tab === "lyrics" ? (
        <section className="panel">
          <div className="panel-title">
            <FileMusic size={16} />
            <h3>Lyrics templates</h3>
          </div>
          <div className="action-row">
            <Link className="button primary" to="/lyrics/new">
              <Plus size={14} /> New template
            </Link>
            <Link className="button ghost" to="/lyrics">
              Open builder
            </Link>
          </div>
          {lyricTemplates.length === 0 ? (
            <div className="empty-state">
              No templates yet. Create one to drive word timing + cut markers in renders.
            </div>
          ) : (
            <div className="batch-list">
              {lyricTemplates.map((t) => (
                <div className="batch-row" key={t.id}>
                  <span className={`dot ${t.status === "saved" ? "good" : t.status === "failed" ? "bad" : "warn"}`} />
                  <div style={{ flex: 1 }}>
                    <strong>{t.title}</strong>
                    <span>
                      {t.status} · {(t.selection_duration_ms / 1000).toFixed(1)}s of {(t.total_duration_ms / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <Link className="button ghost" to={`/lyrics/templates/${t.id}`}>
                    Edit
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab !== "campaign" ? null : (
      <>
      {/* STEP 1 — Connect TikTok */}
      <section className="panel">
        <div className="panel-title">
          <PlugZap size={16} />
          <h3>1. Connect TikTok</h3>
        </div>
        {account ? (
          <div className="stack">
            <div>
              Account: <strong>{account.handle ?? account.tiktok_display_name ?? account.id.slice(0, 8)}</strong>{" "}
              {isConnected ? (
                <span className="status-pill good"><CheckCircle2 size={14} /> connected</span>
              ) : (
                <span className="status-pill warn">not connected</span>
              )}
            </div>
            <a className="button ghost" href={tiktokConnectUrl(account.id)}>
              <PlugZap size={16} /> {isConnected ? "Reconnect" : "Connect TikTok"}
            </a>
          </div>
        ) : (
          <div className="empty-state">Loading account…</div>
        )}
      </section>

      {/* STEP 2 — Source + cadence (only if no active campaign) */}
      {isConnected && !activeBatch ? (
        <section className="panel">
          <div className="panel-title">
            <UploadCloud size={16} />
            <h3>2. Upload audio + start daily campaign</h3>
          </div>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              run("Campaign launch", startCampaign);
            }}
          >
            <label>
              Audio (MP3/WAV/M4A)
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setAudioFile(f);
                  setTrimmedAudio(null);
                }}
                required={!trimmedAudio}
              />
            </label>
            {audioFile ? (
              <AudioTrimmer
                file={audioFile}
                maxDurationSec={duration}
                onTrimmed={(blob, durationSec) =>
                  setTrimmedAudio({ blob, durationSec, name: audioFile.name })
                }
              />
            ) : null}
            {trimmedAudio ? (
              <div className="banner">
                ✓ Trimmed clip ready ({trimmedAudio.durationSec.toFixed(1)}s).
              </div>
            ) : null}
            <label>
              Post duration
              <div className="action-row" style={{ flexWrap: "wrap", gap: 6 }}>
                {DURATIONS.map((d) => (
                  <button
                    type="button"
                    key={d}
                    className={`button ${duration === d ? "primary" : "ghost"}`}
                    onClick={() => {
                      setDuration(d);
                      // Re-trim required if user shrinks below current selection.
                      setTrimmedAudio(null);
                    }}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </label>
            <label>
              Theme / visual prompt (AI will generate per-post shot prompts)
              <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </label>
            <div className="split">
              <label>
                Source
                <select value={sourceMode} onChange={(e) => setSourceMode(e.target.value as SourceMode)}>
                  <option value="stock">Stock footage (Pexels + Pixabay)</option>
                  <option value="mixed">Mixed: stock + Seedance 2</option>
                  <option value="seedance">Seedance 2 only</option>
                </select>
              </label>
              <label>
                Posts to queue
                <input type="number" min={1} max={50} value={postCount} onChange={(e) => setPostCount(Number(e.target.value))} />
              </label>
            </div>
            <div className="banner" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Info size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              <span>
                <strong>Stock footage</strong> is sourced from Pexels + Pixabay (and any clips you've added to your library), ranked for portrait aspect, and cached privately in Supabase Storage.{" "}
                <strong>Seedance 2</strong> generates per-segment AI video via fal.ai. The optional <strong>remote render</strong> step is a Remotion karaoke-caption pass that's currently a pass-through stub.
              </span>
            </div>
            {duration > 15 ? (
              <div className="banner">
                {Math.ceil(duration / 15)} clips per post will be stitched together with ffmpeg.
              </div>
            ) : null}
            <button className="button primary" disabled={busy || !trimmedAudio} type="submit">
              {busy ? <Loader2 className="spin" size={16} /> : <CalendarClock size={16} />} Launch daily campaign
            </button>
          </form>
        </section>
      ) : null}

      {/* STEP 3 — Active campaign */}
      {activeBatch ? (
        <section className="panel">
          <div className="panel-title">
            <CalendarClock size={16} />
            <h3>Active campaign · {activeBatch.source_mode}</h3>
          </div>
          <div className="action-row">
            <button
              className="button"
              disabled={busy}
              onClick={() => run("Pause", () => callCampaign("pause", { batchId: activeBatch.id }))}
            >
              <PauseCircle size={16} /> Pause
            </button>
            <button className="button" disabled={busy} onClick={() => run("Refresh", refresh)}>
              <RefreshCcw size={16} /> Refresh
            </button>
          </div>
        </section>
      ) : null}

      {/* Paused batches → resume */}
      {(data?.batches ?? []).filter((b) => !!b.paused_at).map((b) => (
        <section className="panel" key={b.id}>
          <div className="panel-title">
            <PauseCircle size={16} />
            <h3>Paused · {b.source_mode}</h3>
          </div>
          <button
            className="button"
            disabled={busy}
            onClick={() => run("Resume", () => callCampaign("resume", { batchId: b.id }))}
          >
            <PlayCircle size={16} /> Resume
          </button>
        </section>
      ))}

      {/* Queue view */}
      {data && data.items.length > 0 ? (
        <section className="panel">
          <div className="panel-title">
            <CalendarClock size={16} />
            <h3>Upcoming posts</h3>
          </div>
          <div className="batch-list">
            {data.items.slice(0, 20).map((item) => {
              const post = data.posts.find((p) => p.generation_item_id === item.id);
              return (
                <div className="batch-row" key={item.id}>
                  <span className={`dot ${statusTone(item.status)}`} />
                  <div style={{ flex: 1 }}>
                    <strong>{new Date(item.scheduled_at).toLocaleString()}</strong>
                    <span>
                      {item.status}{item.render_provider ? ` · ${item.render_provider}` : ""}{post ? ` · post ${post.status}` : ""}
                    </span>
                    {item.error_message ? (
                      <span className="status-pill bad" style={{ marginTop: 4 }}>{item.error_message}</span>
                    ) : null}
                  </div>
                  <button
                    className="button ghost"
                    title="Regenerate"
                    disabled={busy}
                    onClick={() => run("Regenerate", () => callCampaign("regenerate", { itemId: item.id }))}
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
