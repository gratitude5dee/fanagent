// Fanpage Autopilot — one-time setup wizard + queue view.
// Wraps the fanpage-campaign edge function. No router required; rendered as a
// top-level mode in App.tsx.

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Info, Loader2, PauseCircle, PlayCircle, PlugZap, RefreshCcw, RotateCcw, Sparkles, UploadCloud } from "lucide-react";
import { SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import AudioTrimmer from "@/components/autopilot/AudioTrimmer";

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
};

type Item = {
  id: string;
  batch_id: string;
  status: string;
  scheduled_at: string;
  stock_clip_url: string | null;
  render_provider: string | null;
  error_message: string | null;
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
  const [audio, setAudio] = useState<File | null>(null);
  const [duration, setDuration] = useState<Duration>(15);
  const [sourceMode, setSourceMode] = useState<SourceMode>("stock");
  const [postCount, setPostCount] = useState(14);
  const [prompt, setPrompt] = useState("aesthetic vertical cinematic visuals");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    if (!audio) throw new Error("Pick an audio file first.");
    if (!account) throw new Error("No account.");
    if (!isConnected) throw new Error("Connect TikTok first.");
    const startAt = new Date(Date.now() + 15 * 60_000).toISOString();
    await callCampaign("create", {
      accountId: account.id,
      audioBase64: await fileToBase64(audio),
      audioMimeType: audio.type || "audio/mpeg",
      audioFileName: audio.name,
      sourceMode,
      durationSeconds: duration,
      postCount,
      cadenceMinutes: 1440,
      prompt,
      startAt,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }

  return (
    <div className="autopilot-panel stack">
      <header className="panel-title">
        <Sparkles size={18} />
        <h2>Fanpage Autopilot</h2>
      </header>

      {message ? <div className="banner">{message}</div> : null}

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
              Audio (MP3/WAV/M4A, ≤12MB)
              <input type="file" accept="audio/*" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} required />
            </label>
            <label>
              Post duration
              <div className="action-row" style={{ flexWrap: "wrap", gap: 6 }}>
                {DURATIONS.map((d) => (
                  <button
                    type="button"
                    key={d}
                    className={`button ${duration === d ? "primary" : "ghost"}`}
                    onClick={() => setDuration(d)}
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
            {duration > 15 ? (
              <div className="banner">
                {Math.ceil(duration / 15)} clips per post will be stitched together with ffmpeg.
              </div>
            ) : null}
            <button className="button primary" disabled={busy || !audio} type="submit">
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
