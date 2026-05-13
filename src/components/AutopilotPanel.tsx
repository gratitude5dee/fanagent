// Fanpage Autopilot — one-time setup wizard + queue view.
// Wraps the fanpage-campaign edge function. No router required; rendered as a
// top-level mode in App.tsx.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock,
  CheckCircle2,
  FileMusic,
  Info,
  Loader2,
  PauseCircle,
  Plus,
  PlayCircle,
  PlugZap,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  UploadCloud,
} from "lucide-react";
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
  provider?: string | null;
  prompt?: string | null;
  segments?: Segment[] | null;
  stock_clip_url: string | null;
  render_provider: string | null;
  error_message: string | null;
  lyric_template_id?: string | null;
  stage_events?: Array<{ stage?: string; at?: string; [key: string]: unknown }> | null;
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

type Diagnostics = {
  env: Record<string, boolean>;
  buckets: Array<{ name: string; ok: boolean }>;
  account: {
    id: string;
    platform: string;
    handle: string | null;
    tiktokConnected: boolean;
    tiktokCreatorInfo: Record<string, unknown> | null;
  } | null;
  queueCounts: Record<string, number>;
  lastWorkerError: unknown;
  cron: {
    configured: boolean;
    schedule: string;
    detectable: boolean;
  };
  schema: {
    generationBatchesSettings: boolean;
    generationItemsQueueColumns: boolean;
    workerRuns: boolean;
    errors: string[];
  };
  recentWorkerRuns: Array<{
    function_name: string;
    started_at: string;
    ended_at: string | null;
    items_processed: number;
    errors_count: number;
    detail?: unknown;
  }>;
  recentFailedItems: Array<{
    id: string;
    status: string;
    provider: string | null;
    error_message: string | null;
    updated_at: string;
  }>;
};

type SourceMode = "stock" | "seedance" | "mixed" | "gmi_seedance";
const DURATIONS = [15, 30, 45, 60, 75, 90] as const;
type Duration = (typeof DURATIONS)[number];
type Segment = {
  source?: string | null;
  url?: string | null;
  provider?: string | null;
  externalId?: string | null;
  query?: string | null;
  durationSec?: number | null;
  reused?: boolean | null;
};

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

function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function statusTone(status: string): string {
  if (["ready", "complete", "posted"].includes(status)) return "good";
  if (["failed", "skipped"].includes(status)) return "bad";
  if (["transcribing", "picking_stock", "rendering", "generating", "posting"].includes(status)) {
    return "warn";
  }
  return "idle";
}

function summarizeSegments(
  segments: Segment[] | null | undefined,
  fallback?: string | null,
): string {
  if (!segments?.length) return fallback || "visuals pending";
  const labels = segments.map((segment) => {
    const source = segment.source || "visual";
    return segment.provider ? `${source}:${segment.provider}` : source;
  });
  return Array.from(new Set(labels)).join(" + ");
}

export default function AutopilotPanel() {
  const [data, setData] = useState<CampaignList | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [trimmedAudio, setTrimmedAudio] = useState<{
    blob: Blob;
    durationSec: number;
    name: string;
    startSec: number;
    endSec: number;
    originalFileName: string;
  } | null>(null);
  const [duration, setDuration] = useState<Duration>(15);
  const [sourceMode, setSourceMode] = useState<SourceMode>("stock");
  const [postCount, setPostCount] = useState(14);
  const [startAt, setStartAt] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 15 * 60_000)),
  );
  const [cadenceMinutes, setCadenceMinutes] = useState(1440);
  const [prompt, setPrompt] = useState("aesthetic vertical cinematic visuals");
  const [stockProviders, setStockProviders] = useState({
    library: true,
    pexels: true,
    pixabay: true,
  });
  const [stockKeywords, setStockKeywords] = useState("");
  const [stockNegativeKeywords, setStockNegativeKeywords] = useState("logo, watermark, text");
  const [stockCategory, setStockCategory] = useState("");
  const [stockMood, setStockMood] = useState("");
  const [stockPortraitOnly, setStockPortraitOnly] = useState(true);
  const [stockAvoidReuse, setStockAvoidReuse] = useState(true);
  const [stockAllowReuse, setStockAllowReuse] = useState(true);
  const [seedanceResolution, setSeedanceResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [publishPrivacy, setPublishPrivacy] = useState("SELF_ONLY");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"campaign" | "lyrics">("campaign");
  const [lyricTemplateId, setLyricTemplateId] = useState<string | "">("");
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  const lyricTemplates = useMemo(() => data?.lyricTemplates ?? [], [data?.lyricTemplates]);
  const templateById = useMemo(
    () => new Map(lyricTemplates.map((t) => [t.id, t])),
    [lyricTemplates],
  );

  const account = data?.account ?? null;
  const isConnected = !!account?.tiktok_connected_at;
  const activeBatches = useMemo(
    () => (data?.batches ?? []).filter((b) => !b.paused_at && b.status !== "complete"),
    [data],
  );
  const schemaReady = diagnostics
    ? diagnostics.schema.generationBatchesSettings &&
      diagnostics.schema.generationItemsQueueColumns &&
      diagnostics.schema.workerRuns
    : false;

  async function refresh() {
    try {
      const next = await callCampaign<CampaignList>("list");
      setData(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshDiagnostics() {
    try {
      const next = await callCampaign<Diagnostics>("diagnostics");
      setDiagnostics(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    refresh();
    refreshDiagnostics();
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
    if (!schemaReady) throw new Error("Database queue schema is not ready.");
    const scheduledStart = new Date(startAt);
    if (!Number.isFinite(scheduledStart.getTime())) throw new Error("Choose a valid start time.");
    await callCampaign("create", {
      accountId: account.id,
      audioBase64: await blobToBase64(trimmedAudio.blob),
      audioMimeType: "audio/mpeg",
      audioFileName: trimmedAudio.name.replace(/\.[^.]+$/, "") + ".mp3",
      clipSelection: {
        startSec: trimmedAudio.startSec,
        endSec: trimmedAudio.endSec,
        durationSec: trimmedAudio.durationSec,
        originalFileName: trimmedAudio.originalFileName,
      },
      sourceMode,
      durationSeconds: duration,
      postCount,
      cadenceMinutes,
      prompt,
      stockSettings: {
        providers: Object.entries(stockProviders)
          .filter(([, enabled]) => enabled)
          .map(([provider]) => provider),
        keywords: stockKeywords
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        negativeKeywords: stockNegativeKeywords
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        category: stockCategory || null,
        mood: stockMood || null,
        portraitOnly: stockPortraitOnly,
        minDurationSec: Math.min(15, duration),
        maxDurationSec: Math.max(15, duration * 3),
        avoidReuseWithinBatch: stockAvoidReuse,
        allowReuseWhenExhausted: stockAllowReuse,
      },
      seedanceSettings: {
        resolution: seedanceResolution,
      },
      publishDefaults: {
        privacyLevel: publishPrivacy,
        disableDuet: true,
        disableStitch: true,
        disableComment: false,
      },
      startAt: scheduledStart.toISOString(),
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

      {diagnostics ? (
        <section className="panel">
          <div className="panel-title">
            <Info size={16} />
            <h3>Preflight</h3>
          </div>
          <div className="batch-list">
            <div className="batch-row">
              <span className={`dot ${schemaReady ? "good" : "bad"}`} />
              <div>
                <strong>Database queue schema</strong>
                <span>
                  {diagnostics.schema.errors.length
                    ? diagnostics.schema.errors.join(" · ")
                    : "ready"}
                </span>
              </div>
            </div>
            <div className="batch-row">
              <span className={`dot ${diagnostics.account?.tiktokConnected ? "good" : "warn"}`} />
              <div>
                <strong>TikTok account</strong>
                <span>
                  {diagnostics.account?.handle ?? diagnostics.account?.id?.slice(0, 8) ?? "none"} ·{" "}
                  {diagnostics.account?.tiktokConnected
                    ? "connected for auto-post"
                    : "generation enabled, publishing waits for connection"}
                </span>
              </div>
            </div>
            <div className="batch-row">
              <span
                className={`dot ${
                  diagnostics.buckets.every((bucket) => bucket.ok) ? "good" : "warn"
                }`}
              />
              <div>
                <strong>Storage buckets</strong>
                <span>
                  {diagnostics.buckets
                    .map((bucket) => `${bucket.name}:${bucket.ok ? "ok" : "missing"}`)
                    .join(" · ")}
                </span>
              </div>
            </div>
            <div className="batch-row">
              <span
                className={`dot ${
                  diagnostics.env.pexels ||
                  diagnostics.env.pixabay ||
                  diagnostics.env.fal ||
                  diagnostics.env.gmi
                    ? "good"
                    : "bad"
                }`}
              />
              <div>
                <strong>Providers</strong>
                <span>
                  stock{" "}
                  {diagnostics.env.pexels || diagnostics.env.pixabay ? "ready" : "missing keys"} ·
                  fal {diagnostics.env.fal ? "ready" : "missing"} · GMI{" "}
                  {diagnostics.env.gmi ? "ready" : "optional missing"}
                </span>
              </div>
            </div>
            <div className="batch-row">
              <span
                className={`dot ${
                  diagnostics.env.tiktokClientKey &&
                  diagnostics.env.tiktokClientSecret &&
                  diagnostics.env.tiktokRedirectUri &&
                  diagnostics.env.tokenEncryptionKey
                    ? "good"
                    : "warn"
                }`}
              />
              <div>
                <strong>TikTok direct post</strong>
                <span>
                  {diagnostics.env.tiktokClientKey &&
                  diagnostics.env.tiktokClientSecret &&
                  diagnostics.env.tiktokRedirectUri
                    ? "OAuth configured"
                    : "OAuth secrets incomplete"}{" "}
                  · cron {diagnostics.env.cronSecret ? "ready" : "manual only"}
                </span>
              </div>
            </div>
            <div className="batch-row">
              <span className={`dot ${diagnostics.cron.configured ? "good" : "warn"}`} />
              <div>
                <strong>Workers</strong>
                <span>
                  cron {diagnostics.cron.configured ? diagnostics.cron.schedule : "manual only"} ·{" "}
                  queue{" "}
                  {Object.entries(diagnostics.queueCounts)
                    .map(([status, count]) => `${status}:${count}`)
                    .join(" · ") || "empty"}
                </span>
              </div>
            </div>
            {diagnostics.lastWorkerError ? (
              <div className="batch-row">
                <span className="dot bad" />
                <div>
                  <strong>Last worker error</strong>
                  <span>{JSON.stringify(diagnostics.lastWorkerError).slice(0, 240)}</span>
                </div>
              </div>
            ) : null}
          </div>
          <div className="action-row">
            <button className="button ghost" type="button" onClick={refreshDiagnostics}>
              <RefreshCcw size={14} /> Refresh diagnostics
            </button>
          </div>
        </section>
      ) : null}

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
                  <span
                    className={`dot ${t.status === "saved" ? "good" : t.status === "failed" ? "bad" : "warn"}`}
                  />
                  <div style={{ flex: 1 }}>
                    <strong>{t.title}</strong>
                    <span>
                      {t.status} · {(t.selection_duration_ms / 1000).toFixed(1)}s of{" "}
                      {(t.total_duration_ms / 1000).toFixed(1)}s
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
                  Account:{" "}
                  <strong>
                    {account.handle ?? account.tiktok_display_name ?? account.id.slice(0, 8)}
                  </strong>{" "}
                  {isConnected ? (
                    <span className="status-pill good">
                      <CheckCircle2 size={14} /> connected
                    </span>
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

          {/* STEP 2 — Source + cadence */}
          {account ? (
            <section className="panel">
              <div className="panel-title">
                <UploadCloud size={16} />
                <h3>2. Upload audio + schedule campaign</h3>
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
                    onTrimmed={(blob, selection) =>
                      setTrimmedAudio({ blob, name: audioFile.name, ...selection })
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
                    Database queue schema is not ready. Generation is blocked until the live
                    migration is applied.
                  </div>
                ) : null}
                {!isConnected ? (
                  <div className="banner warn">
                    TikTok is not connected. Videos can still generate; auto-posting will wait until
                    OAuth is connected.
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
                    <select
                      value={sourceMode}
                      onChange={(e) => setSourceMode(e.target.value as SourceMode)}
                    >
                      <option value="stock">Stock footage (Pexels + Pixabay)</option>
                      <option value="mixed">Mixed: stock + Seedance 2</option>
                      <option value="seedance">Seedance 2 only</option>
                      <option value="gmi_seedance">GMI Seedance 2</option>
                    </select>
                  </label>
                  <label>
                    Posts to queue
                    <input
                      type="number"
                      min={1}
                      max={250}
                      value={postCount}
                      onChange={(e) => setPostCount(Number(e.target.value))}
                    />
                  </label>
                </div>
                <div className="split schedule-split">
                  <label>
                    First post
                    <input
                      type="datetime-local"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                    />
                  </label>
                  <label>
                    Cadence min
                    <input
                      type="number"
                      min={5}
                      max={10080}
                      value={cadenceMinutes}
                      onChange={(e) => setCadenceMinutes(Number(e.target.value))}
                    />
                  </label>
                </div>
                <section className="panel subtle-panel">
                  <div className="panel-title">
                    <Info size={14} />
                    <h4>Stock controls</h4>
                  </div>
                  <div className="action-row" style={{ flexWrap: "wrap" }}>
                    {(["library", "pexels", "pixabay"] as const).map((provider) => (
                      <label className="check" key={provider}>
                        <input
                          type="checkbox"
                          checked={stockProviders[provider]}
                          onChange={(e) =>
                            setStockProviders((current) => ({
                              ...current,
                              [provider]: e.target.checked,
                            }))
                          }
                        />{" "}
                        {provider}
                      </label>
                    ))}
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={stockPortraitOnly}
                        onChange={(e) => setStockPortraitOnly(e.target.checked)}
                      />{" "}
                      portrait only
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={stockAvoidReuse}
                        onChange={(e) => setStockAvoidReuse(e.target.checked)}
                      />{" "}
                      avoid repeats
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={stockAllowReuse}
                        onChange={(e) => setStockAllowReuse(e.target.checked)}
                      />{" "}
                      reuse if exhausted
                    </label>
                  </div>
                  <div className="split">
                    <label>
                      Keywords
                      <input
                        value={stockKeywords}
                        onChange={(e) => setStockKeywords(e.target.value)}
                        placeholder="concert, neon, crowd"
                      />
                    </label>
                    <label>
                      Avoid
                      <input
                        value={stockNegativeKeywords}
                        onChange={(e) => setStockNegativeKeywords(e.target.value)}
                        placeholder="logo, watermark"
                      />
                    </label>
                  </div>
                  <div className="split">
                    <label>
                      Category
                      <input
                        value={stockCategory}
                        onChange={(e) => setStockCategory(e.target.value)}
                        placeholder="music"
                      />
                    </label>
                    <label>
                      Mood
                      <input
                        value={stockMood}
                        onChange={(e) => setStockMood(e.target.value)}
                        placeholder="high energy"
                      />
                    </label>
                  </div>
                  <label>
                    fal Seedance resolution
                    <select
                      value={seedanceResolution}
                      onChange={(e) =>
                        setSeedanceResolution(e.target.value as "480p" | "720p" | "1080p")
                      }
                    >
                      <option value="480p">480p draft</option>
                      <option value="720p">720p balanced</option>
                      <option value="1080p">1080p final</option>
                    </select>
                  </label>
                  <label>
                    TikTok privacy default
                    <select
                      value={publishPrivacy}
                      onChange={(e) => setPublishPrivacy(e.target.value)}
                    >
                      <option value="SELF_ONLY">SELF_ONLY</option>
                      <option value="MUTUAL_FOLLOW_FRIENDS">MUTUAL_FOLLOW_FRIENDS</option>
                      <option value="FOLLOWER_OF_CREATOR">FOLLOWER_OF_CREATOR</option>
                      <option value="PUBLIC_TO_EVERYONE">PUBLIC_TO_EVERYONE</option>
                    </select>
                  </label>
                </section>
                <label>
                  Lyrics template (optional)
                  <select
                    value={lyricTemplateId}
                    onChange={(e) => setLyricTemplateId(e.target.value)}
                  >
                    <option value="">None — basic captions only</option>
                    {lyricTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title} ({(t.selection_duration_ms / 1000).toFixed(0)}s · {t.status})
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  className="banner"
                  style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
                >
                  <Info size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span>
                    <strong>Stock footage</strong> is sourced from Pexels + Pixabay (and any clips
                    you've added to your library), ranked for portrait aspect, and cached privately
                    in Supabase Storage. <strong>Seedance 2</strong> generates per-segment AI video
                    via fal.ai. <strong>GMI Seedance</strong> is available when its API keys are
                    configured.
                  </span>
                </div>
                {duration > 15 ? (
                  <div className="banner">
                    {Math.ceil(duration / 15)} clips per post will be stitched together with ffmpeg.
                  </div>
                ) : null}
                <button
                  className="button primary"
                  disabled={busy || !trimmedAudio || !schemaReady}
                  type="submit"
                >
                  {busy ? <Loader2 className="spin" size={16} /> : <CalendarClock size={16} />}{" "}
                  Launch campaign
                </button>
              </form>
            </section>
          ) : null}

          {/* STEP 3 — Active campaign */}
          {activeBatches.length ? (
            <section className="panel">
              <div className="panel-title">
                <CalendarClock size={16} />
                <h3>Active campaigns</h3>
              </div>
              <div className="batch-list">
                {activeBatches.slice(0, 8).map((batch) => (
                  <div className="batch-row" key={batch.id}>
                    <span className={`dot ${statusTone(batch.status)}`} />
                    <div style={{ flex: 1 }}>
                      <strong>{batch.source_mode}</strong>
                      <span>
                        {batch.status} · {batch.post_count} posts · every {batch.cadence_minutes}m
                      </span>
                    </div>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        run("Pause", () => callCampaign("pause", { batchId: batch.id }))
                      }
                    >
                      <PauseCircle size={16} /> Pause
                    </button>
                  </div>
                ))}
              </div>
              <div className="action-row">
                <button className="button" disabled={busy} onClick={() => run("Refresh", refresh)}>
                  <RefreshCcw size={16} /> Refresh
                </button>
              </div>
            </section>
          ) : null}

          {/* Paused batches → resume */}
          {(data?.batches ?? [])
            .filter((b) => !!b.paused_at)
            .map((b) => (
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
                  const itemTpl = item.lyric_template_id
                    ? templateById.get(item.lyric_template_id)
                    : null;
                  const segments = Array.isArray(item.segments) ? item.segments : [];
                  const reusedStock = segments.some(
                    (segment) => segment.source === "stock" && segment.reused,
                  );
                  const previewUrl =
                    post?.video_url ?? item.stock_clip_url ?? segments.find((s) => s.url)?.url;
                  return (
                    <div className="batch-row" key={item.id}>
                      <span className={`dot ${statusTone(item.status)}`} />
                      <div style={{ flex: 1 }}>
                        <strong>{new Date(item.scheduled_at).toLocaleString()}</strong>
                        <span>
                          {item.status}
                          {item.render_provider ? ` · ${item.render_provider}` : ""}
                          {post ? ` · post ${post.status}` : ""}
                        </span>
                        <span>
                          Visuals:{" "}
                          {summarizeSegments(segments, item.provider ?? item.render_provider)}
                        </span>
                        {segments.length ? (
                          <span>
                            {segments
                              .map((segment, index) => {
                                const provider = segment.provider ?? segment.source ?? "visual";
                                const reuse = segment.reused ? " reused" : "";
                                return `${index + 1}:${provider}${reuse}`;
                              })
                              .join(" · ")}
                          </span>
                        ) : null}
                        {item.prompt ? <span>{item.prompt.slice(0, 120)}</span> : null}
                        {reusedStock ? (
                          <span className="status-pill warn" style={{ marginTop: 4 }}>
                            reused stock
                          </span>
                        ) : null}
                        {itemTpl ? (
                          <span className="status-pill" style={{ marginTop: 4 }}>
                            <FileMusic size={12} /> {itemTpl.title}
                          </span>
                        ) : null}
                        {item.error_message ? (
                          <span className="status-pill bad" style={{ marginTop: 4 }}>
                            {item.error_message}
                          </span>
                        ) : null}
                        {item.stage_events?.length ? (
                          <span>
                            {item.stage_events
                              .slice(-3)
                              .map((event) => event.stage)
                              .filter(Boolean)
                              .join(" → ")}
                          </span>
                        ) : null}
                      </div>
                      {previewUrl ? (
                        <a
                          className="button ghost"
                          href={previewUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Preview
                        </a>
                      ) : null}
                      <select
                        value={item.lyric_template_id ?? ""}
                        onChange={(e) => setItemTemplate(item.id, e.target.value || null)}
                        disabled={busy}
                        title="Lyrics template"
                        style={{ maxWidth: 160 }}
                      >
                        <option value="">No template</option>
                        {lyricTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                      </select>
                      <button
                        className="button ghost"
                        title="Regenerate"
                        disabled={busy}
                        onClick={() =>
                          run("Regenerate", () => callCampaign("regenerate", { itemId: item.id }))
                        }
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
