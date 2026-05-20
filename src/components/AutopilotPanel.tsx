// Fanpage Autopilot — one-time setup wizard + queue view.
// Wraps the fanpage-campaign edge function. No router required; rendered as a
// top-level mode in App.tsx.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  FileMusic,
  Info,
  PauseCircle,
  PlayCircle,
  RefreshCcw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { SUPABASE_URL } from "@/integrations/supabase/client";
import { CampaignStep } from "@/components/autopilot/CampaignStep";
import { ConnectStep } from "@/components/autopilot/ConnectStep";
import { LyricsStep } from "@/components/autopilot/LyricsStep";
import { UploadStep, type AudioClipStatus, type Duration } from "@/components/autopilot/UploadStep";
import { clipSelectionMatchesDuration } from "@/lib/audio/selection";
import {
  isFanAgentSchemaReady,
  schemaDiagnosticsSummary,
  type FanAgentSchemaDiagnostics,
} from "@/lib/fanagent/diagnostics";
import {
  registerAudioClip,
  transcribeAudioClip,
  type RegisteredAudioClipSummary,
} from "@/lib/fanagent/audioClip";
import {
  buildSourceOptions,
  coerceSelectableSourceMode,
  type SourceMode,
} from "@/lib/fanagent/sourceMode";
import { lyricsApi } from "@/lib/lyrics/api";
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
  schema: FanAgentSchemaDiagnostics;
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

type Segment = {
  source?: string | null;
  url?: string | null;
  provider?: string | null;
  externalId?: string | null;
  query?: string | null;
  durationSec?: number | null;
  reused?: boolean | null;
};

import { invokeEdgeFunction } from "@/lib/fanagent/invokeFunction";

async function callCampaign<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  return invokeEdgeFunction<T>("fanpage-campaign", { action, ...(body ?? {}) });
}

function tiktokConnectUrl(accountId: string): string {
  return `${SUPABASE_URL}/functions/v1/tiktok-oauth-callback?action=connect&accountId=${encodeURIComponent(accountId)}`;
}

function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function splitCsv(value: string): string[] {
  return value
    .split(/[,;\n]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseKeyValueLines(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(/[\n,;]/g)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.includes("=") ? "=" : ":";
        const [key, ...rest] = entry.split(separator);
        return [key?.trim(), rest.join(separator).trim()];
      })
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" &&
          entry[0].length > 0 &&
          typeof entry[1] === "string" &&
          /^https?:\/\//i.test(entry[1]),
      ),
  );
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
  const [sportsLeague, setSportsLeague] = useState("");
  const [sportsTeam, setSportsTeam] = useState("");
  const [sportsAllowedChannels, setSportsAllowedChannels] = useState("");
  const [sportsOwnerAssetUrls, setSportsOwnerAssetUrls] = useState("");
  const [streamerName, setStreamerName] = useState("");
  const [streamerAllowedChannels, setStreamerAllowedChannels] = useState("");
  const [seedanceResolution, setSeedanceResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [publishPrivacy, setPublishPrivacy] = useState("SELF_ONLY");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"campaign" | "lyrics">("campaign");
  const [lyricTemplateId, setLyricTemplateId] = useState<string | "">("");
  const [lyricsDrawerOpen, setLyricsDrawerOpen] = useState(false);
  const [registeredAudioClip, setRegisteredAudioClip] = useState<RegisteredAudioClipSummary | null>(
    null,
  );
  const [audioClipStatus, setAudioClipStatus] = useState<AudioClipStatus>("idle");
  const [audioClipError, setAudioClipError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  const lyricTemplates = useMemo(() => data?.lyricTemplates ?? [], [data?.lyricTemplates]);
  const templateById = useMemo(
    () => new Map(lyricTemplates.map((t) => [t.id, t])),
    [lyricTemplates],
  );
  const lyricTemplateIdRef = useRef(lyricTemplateId);

  const account = data?.account ?? null;
  const accountId = account?.id ?? "";
  const isConnected = !!account?.tiktok_connected_at;
  const activeBatches = useMemo(
    () => (data?.batches ?? []).filter((b) => !b.paused_at && b.status !== "complete"),
    [data],
  );
  const schemaReady = isFanAgentSchemaReady(diagnostics?.schema);
  const sourceOptions = useMemo(() => buildSourceOptions(diagnostics?.env), [diagnostics?.env]);
  const trimmedAudioKey = useMemo(
    () =>
      trimmedAudio
        ? [
            trimmedAudio.name,
            trimmedAudio.startSec,
            trimmedAudio.endSec,
            trimmedAudio.durationSec,
            trimmedAudio.blob.size,
          ].join(":")
        : "",
    [trimmedAudio],
  );

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
      const message = err instanceof Error ? err.message : String(err);
      // Swallow transport-level aborts (StrictMode double-mount, HMR) — they
      // self-heal on the next polling tick. Only surface real failures.
      if (/aborted|AbortError|signal is aborted/i.test(message)) return;
      setMessage(message);
    }
  }

  useEffect(() => {
    refresh();
    refreshDiagnostics();
    const t = setInterval(() => {
      refresh();
      refreshDiagnostics();
    }, 15_000);
    return () => clearInterval(t);
  }, []);


  useEffect(() => {
    if (trimmedAudio && !lyricTemplateId) setLyricsDrawerOpen(true);
  }, [trimmedAudio, lyricTemplateId]);

  useEffect(() => {
    lyricTemplateIdRef.current = lyricTemplateId;
  }, [lyricTemplateId]);

  useEffect(() => {
    let cancelled = false;
    setRegisteredAudioClip(null);
    setAudioClipError(null);

    if (!trimmedAudio) {
      setAudioClipStatus("idle");
      return () => {
        cancelled = true;
      };
    }
    if (!accountId) {
      setAudioClipStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    async function registerAndTranscribeClip() {
      try {
        setAudioClipStatus("registering");
        const registered = await registerAudioClip({
          accountId,
          trimmedAudio: trimmedAudio!,
        });
        if (cancelled) return;
        setRegisteredAudioClip(registered.audio_clip);
        setAudioClipStatus("transcribing");
        setLyricsDrawerOpen(true);

        try {
          const transcribed = await transcribeAudioClip(registered.audio_clip.id);
          if (cancelled) return;
          setRegisteredAudioClip(transcribed.audio_clip);
          if (!lyricTemplateIdRef.current) {
            try {
              const template = await lyricsApi.createFromAudioClip({
                audioClipId: transcribed.audio_clip.id,
                title: `${trimmedAudio!.originalFileName} lyrics`,
              });
              if (cancelled) return;
              setLyricTemplateId(template.template.id);
              await refresh();
            } catch (templateError) {
              if (cancelled) return;
              setAudioClipError(
                `Template creation failed: ${
                  templateError instanceof Error ? templateError.message : String(templateError)
                }`,
              );
            }
          }
          setAudioClipStatus("ready");
        } catch (error) {
          if (cancelled) return;
          setRegisteredAudioClip(registered.audio_clip);
          setAudioClipStatus("failed");
          setAudioClipError(error instanceof Error ? error.message : String(error));
        }
      } catch (error) {
        if (cancelled) return;
        setRegisteredAudioClip(null);
        setAudioClipStatus("failed");
        setAudioClipError(error instanceof Error ? error.message : String(error));
      }
    }

    registerAndTranscribeClip();
    return () => {
      cancelled = true;
    };
  }, [accountId, trimmedAudio, trimmedAudioKey]);

  useEffect(() => {
    setSourceMode((current) => coerceSelectableSourceMode(current, diagnostics?.env));
  }, [diagnostics?.env]);

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
    if (diagnostics && !schemaReady) {
      throw new Error(
        `Database queue schema is not ready: ${schemaDiagnosticsSummary(diagnostics.schema)}`,
      );
    }
    if (!registeredAudioClip) {
      throw new Error("Wait for the audio clip to finish registering before launching.");
    }
    if (!lyricTemplateId) {
      throw new Error("Review and save a lyric template before launching.");
    }
    if (
      !clipSelectionMatchesDuration(
        { startSec: trimmedAudio.startSec, endSec: trimmedAudio.endSec },
        duration,
      )
    ) {
      throw new Error(`Trimmed audio must be exactly ${duration}s before launching.`);
    }
    const scheduledStart = new Date(startAt);
    if (!Number.isFinite(scheduledStart.getTime())) throw new Error("Choose a valid start time.");
    const commonSourceSettings = {
      providers: Object.entries(stockProviders)
        .filter(([, enabled]) => enabled)
        .map(([provider]) => provider),
      keywords: splitCsv(stockKeywords),
      negativeKeywords: splitCsv(stockNegativeKeywords),
      category: stockCategory || null,
      mood: stockMood || null,
      portraitOnly: stockPortraitOnly,
      minDurationSec: Math.min(15, duration),
      maxDurationSec: Math.max(15, duration * 3),
      avoidReuseWithinBatch: stockAvoidReuse,
      allowReuseWhenExhausted: stockAllowReuse,
    };
    await callCampaign("create", {
      accountId: account.id,
      audioClipId: registeredAudioClip.id,
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
      sourceSettings: {
        stock: commonSourceSettings,
        seedance: {
          resolution: seedanceResolution,
        },
        gmi_seedance: {
          resolution: seedanceResolution,
        },
        sports_edit: {
          league: sportsLeague || null,
          team: sportsTeam || null,
          allowedChannels: splitCsv(sportsAllowedChannels),
          ownerAssetUrls: parseKeyValueLines(sportsOwnerAssetUrls),
        },
        streamer_clip: {
          streamer: streamerName || null,
          allowedChannels: splitCsv(streamerAllowedChannels),
        },
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

  async function recoverRecentFailures() {
    await callCampaign("recoverRecentFailures", {
      limit: 50,
      includeFailed: true,
      includeStaleActive: true,
    });
    await refreshDiagnostics();
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
                <span>{schemaDiagnosticsSummary(diagnostics.schema)}</span>
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
            {diagnostics.recentFailedItems.length > 0 ? (
              <div className="batch-row">
                <span className="dot bad" />
                <div style={{ flex: 1 }}>
                  <strong>Recent failed generation items</strong>
                  <span>
                    {diagnostics.recentFailedItems.length} failed item
                    {diagnostics.recentFailedItems.length === 1 ? "" : "s"} visible in diagnostics ·
                    latest{" "}
                    {diagnostics.recentFailedItems[0]?.error_message?.slice(0, 140) ??
                      "no error message"}
                  </span>
                </div>
                <button
                  className="button"
                  disabled={busy}
                  type="button"
                  onClick={() => run("Recovery", recoverRecentFailures)}
                >
                  <RefreshCcw size={14} /> Recover
                </button>
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
        <LyricsStep
          lyricTemplateId={lyricTemplateId}
          lyricTemplates={lyricTemplates}
          drawerOpen={lyricsDrawerOpen}
          onDrawerOpen={setLyricsDrawerOpen}
          onTemplate={setLyricTemplateId}
        />
      ) : null}

      {tab !== "campaign" ? null : (
        <>
          <ConnectStep
            account={account}
            isConnected={isConnected}
            connectUrl={account ? tiktokConnectUrl(account.id) : null}
          />
          {account ? (
            <>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  run("Campaign launch", startCampaign);
                }}
              >
                <UploadStep
                  audioFile={audioFile}
                  duration={duration}
                  isConnected={isConnected}
                  schemaReady={schemaReady}
                  trimmedAudio={trimmedAudio}
                  audioClipStatus={audioClipStatus}
                  audioClipError={audioClipError}
                  registeredAudioClipId={registeredAudioClip?.id ?? null}
                  onAudioFile={setAudioFile}
                  onDuration={setDuration}
                  onTrimmedAudio={setTrimmedAudio}
                />
                <LyricsStep
                  lyricTemplateId={lyricTemplateId}
                  lyricTemplates={lyricTemplates}
                  drawerOpen={lyricsDrawerOpen}
                  onDrawerOpen={setLyricsDrawerOpen}
                  onTemplate={setLyricTemplateId}
                />
                <CampaignStep
                  busy={busy}
                  cadenceMinutes={cadenceMinutes}
                  duration={duration}
                  lyricTemplateReady={!!lyricTemplateId}
                  postCount={postCount}
                  prompt={prompt}
                  publishPrivacy={publishPrivacy}
                  schemaReady={schemaReady}
                  seedanceResolution={seedanceResolution}
                  sourceMode={sourceMode}
                  sourceOptions={sourceOptions}
                  sportsAllowedChannels={sportsAllowedChannels}
                  sportsLeague={sportsLeague}
                  sportsOwnerAssetUrls={sportsOwnerAssetUrls}
                  sportsTeam={sportsTeam}
                  startAt={startAt}
                  stockAllowReuse={stockAllowReuse}
                  stockAvoidReuse={stockAvoidReuse}
                  stockCategory={stockCategory}
                  stockKeywords={stockKeywords}
                  stockMood={stockMood}
                  stockNegativeKeywords={stockNegativeKeywords}
                  stockPortraitOnly={stockPortraitOnly}
                  stockProviders={stockProviders}
                  streamerAllowedChannels={streamerAllowedChannels}
                  streamerName={streamerName}
                  trimmedAudioReady={!!trimmedAudio && !!registeredAudioClip}
                  onCadenceMinutes={setCadenceMinutes}
                  onPostCount={setPostCount}
                  onPrompt={setPrompt}
                  onPublishPrivacy={setPublishPrivacy}
                  onSeedanceResolution={setSeedanceResolution}
                  onSourceMode={setSourceMode}
                  onSportsAllowedChannels={setSportsAllowedChannels}
                  onSportsLeague={setSportsLeague}
                  onSportsOwnerAssetUrls={setSportsOwnerAssetUrls}
                  onSportsTeam={setSportsTeam}
                  onStartAt={setStartAt}
                  onStockAllowReuse={setStockAllowReuse}
                  onStockAvoidReuse={setStockAvoidReuse}
                  onStockCategory={setStockCategory}
                  onStockKeywords={setStockKeywords}
                  onStockMood={setStockMood}
                  onStockNegativeKeywords={setStockNegativeKeywords}
                  onStockPortraitOnly={setStockPortraitOnly}
                  onStockProviders={setStockProviders}
                  onStreamerAllowedChannels={setStreamerAllowedChannels}
                  onStreamerName={setStreamerName}
                />
              </form>
            </>
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
