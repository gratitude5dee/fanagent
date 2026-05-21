import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CalendarClock,
  CheckCircle2,
  FileMusic,
  Info,
  Loader2,
  PauseCircle,
  PlayCircle,
  PlugZap,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import AudioTrimmer from "@/components/autopilot/AudioTrimmer";
import CategoryPicker, { categoryLabel } from "@/components/autopilot/CategoryPicker";
import type { LyricTemplateSummary } from "@/lib/lyrics/types";

type AutopilotWizardProps = {
  initialTab?: "campaign" | "lyrics";
  focusLyricsStepSignal?: number;
  initialLyricTemplateId?: string;
};

type Step = "connect" | "upload" | "lyrics" | "category" | "campaign" | "generating";
type SourceMode = "stock" | "seedance" | "mixed" | "gmi_seedance";
const DURATIONS = [15, 30, 45, 60, 75, 90] as const;
type Duration = (typeof DURATIONS)[number];

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
  audio_asset_id?: string | null;
  source_mode: string;
  status: string;
  post_count: number;
  cadence_minutes: number;
  paused_at: string | null;
  created_at: string;
  lyric_template_id?: string | null;
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
  account: { id: string; handle: string | null; tiktokConnected: boolean } | null;
  queueCounts: Record<string, number>;
  lastWorkerError: unknown;
  cron: { configured: boolean; schedule: string; detectable: boolean };
  schema: { generationBatchesSettings: boolean; generationItemsQueueColumns: boolean; workerRuns: boolean; errors: string[] };
};

function tiktokConnectUrl(accountId: string): string {
  return `${SUPABASE_URL}/functions/v1/tiktok-oauth-callback?action=connect&accountId=${encodeURIComponent(accountId)}`;
}

function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

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

function statusTone(status: string): string {
  if (["ready", "complete", "posted"].includes(status)) return "good";
  if (["failed", "skipped"].includes(status)) return "bad";
  if (["transcribing", "picking_stock", "rendering", "generating", "posting", "planning"].includes(status)) return "warn";
  return "idle";
}

function cadenceLabel(minutes: number): string {
  if (minutes === 1440) return "Every day";
  if (minutes % 1440 === 0) return `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return `Every ${minutes / 60} hours`;
  return `Every ${minutes} minutes`;
}

function summarizeSegments(segments: Segment[] | null | undefined, fallback?: string | null): string {
  if (!segments?.length) return fallback || "visuals pending";
  return Array.from(new Set(segments.map((segment) => segment.provider ? `${segment.source || "visual"}:${segment.provider}` : segment.source || "visual"))).join(" + ");
}

function wordCount(template: LyricTemplateSummary | null): number {
  const anyTemplate = template as unknown as { word_count?: number; words?: unknown[] } | null;
  if (!anyTemplate) return 0;
  if (typeof anyTemplate.word_count === "number") return anyTemplate.word_count;
  if (Array.isArray(anyTemplate.words)) return anyTemplate.words.length;
  return 0;
}

function StepCard({
  id,
  index,
  title,
  active,
  complete,
  summary,
  children,
  onClick,
}: {
  id: Step;
  index: number;
  title: string;
  active: boolean;
  complete: boolean;
  summary: string;
  children: React.ReactNode;
  onClick: (step: Step) => void;
}) {
  return (
    <section className={`wizard-step ${active ? "active" : ""} ${complete ? "complete" : ""}`}>
      <button type="button" className="step-summary" onClick={() => onClick(id)}>
        <span className="step-number">{complete ? <CheckCircle2 size={16} /> : index}</span>
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
      </button>
      {active ? <div className="wizard-step-body">{children}</div> : null}
    </section>
  );
}

export default function AutopilotWizard({ initialTab, initialLyricTemplateId }: AutopilotWizardProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<CampaignList | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [trimmedAudio, setTrimmedAudio] = useState<{ blob: Blob; durationSec: number; name: string; startSec: number; endSec: number; originalFileName: string } | null>(null);
  const [duration, setDuration] = useState<Duration>(30);
  const [sourceMode, setSourceMode] = useState<SourceMode>("stock");
  const [postCount, setPostCount] = useState(14);
  const [startAt, setStartAt] = useState(() => toLocalInputValue(new Date(Date.now() + 24 * 60 * 60_000)));
  const [cadenceMinutes, setCadenceMinutes] = useState(1440);
  const [prompt, setPrompt] = useState("aesthetic vertical cinematic visuals");
  const [stockProviders, setStockProviders] = useState({ library: true, pexels: true, pixabay: true });
  const [stockKeywords, setStockKeywords] = useState("");
  const [stockNegativeKeywords, setStockNegativeKeywords] = useState("logo, watermark, text");
  const [stockCategory, setStockCategory] = useState("");
  const [randomize, setRandomize] = useState(false);
  const [stockMood, setStockMood] = useState("");
  const [stockPortraitOnly, setStockPortraitOnly] = useState(true);
  const [stockAvoidReuse, setStockAvoidReuse] = useState(true);
  const [stockAllowReuse, setStockAllowReuse] = useState(true);
  const [seedanceResolution, setSeedanceResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [publishPrivacy, setPublishPrivacy] = useState("SELF_ONLY");
  const [lyricTemplateId, setLyricTemplateId] = useState<string | "">(initialLyricTemplateId ?? "");
  const [lyricsSkipped, setLyricsSkipped] = useState(false);
  const [step, setStep] = useState<Step>(initialTab === "lyrics" ? "lyrics" : "connect");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastLaunchedAudioAssetId, setLastLaunchedAudioAssetId] = useState<string | null>(null);
  const notifiedReadyRef = useRef(false);

  const lyricTemplates = useMemo(() => data?.lyricTemplates ?? [], [data?.lyricTemplates]);
  const templateById = useMemo(() => new Map(lyricTemplates.map((t) => [t.id, t])), [lyricTemplates]);
  const selectedTemplate = lyricTemplateId ? templateById.get(lyricTemplateId) ?? null : null;
  const account = data?.account ?? null;
  const isConnected = !!account?.tiktok_connected_at;
  const activeBatches = useMemo(() => (data?.batches ?? []).filter((b) => !b.paused_at && !["complete", "failed", "partial"].includes(b.status)), [data]);
  const activeItems = useMemo(() => {
    const batchIds = new Set(activeBatches.map((b) => b.id));
    return (data?.items ?? []).filter((item) => batchIds.has(item.batch_id));
  }, [activeBatches, data?.items]);
  const schemaReady = diagnostics ? diagnostics.schema.generationBatchesSettings && diagnostics.schema.generationItemsQueueColumns && diagnostics.schema.workerRuns : false;

  const connectComplete = !!account;
  const uploadComplete = !!trimmedAudio;
  const lyricsComplete = lyricsSkipped || selectedTemplate?.status === "saved";
  const categoryComplete = randomize || stockCategory !== "";
  const campaignComplete = postCount >= 1 && Number.isFinite(new Date(startAt).getTime()) && new Date(startAt).getTime() > Date.now();
  const canGenerate = connectComplete && uploadComplete && lyricsComplete && categoryComplete && campaignComplete && schemaReady;

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
  }, []);

  useEffect(() => {
    const interval = activeBatches.length > 0 ? 5_000 : 15_000;
    const t = setInterval(refresh, interval);
    return () => clearInterval(t);
  }, [activeBatches.length]);

  useEffect(() => {
    if (step === "connect" && connectComplete) setStep("upload");
    else if (step === "upload" && uploadComplete) setStep("lyrics");
    else if (step === "lyrics" && lyricsComplete) setStep("category");
    else if (step === "category" && categoryComplete) setStep("campaign");
  }, [step, connectComplete, uploadComplete, lyricsComplete, categoryComplete]);

  useEffect(() => {
    if (notifiedReadyRef.current || activeItems.length === 0) return;
    const ready = activeItems.find((item) => ["ready", "complete"].includes(item.status));
    if (!ready) return;
    notifiedReadyRef.current = true;
    const target = `/clips${lastLaunchedAudioAssetId ? `?audioClipId=${encodeURIComponent(lastLaunchedAudioAssetId)}` : ""}`;
    toast.success("🎬 Your first video is ready!", { action: { label: "View", onClick: () => navigate(target) } });
    navigate(target);
  }, [activeItems, lastLaunchedAudioAssetId, navigate]);

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
    const response = await callCampaign<{ audioAsset?: { id?: string }; batch?: { id?: string } }>("create", {
      accountId: account.id,
      audioBase64: await blobToBase64(trimmedAudio.blob),
      audioMimeType: trimmedAudio.blob.type || "audio/wav",
      audioFileName: trimmedAudio.name.replace(/\.[^.]+$/, "") + ".wav",
      clipSelection: { startSec: trimmedAudio.startSec, endSec: trimmedAudio.endSec, durationSec: trimmedAudio.durationSec, originalFileName: trimmedAudio.originalFileName },
      sourceMode,
      durationSeconds: duration,
      postCount,
      cadenceMinutes,
      prompt,
      stockSettings: {
        providers: Object.entries(stockProviders).filter(([, enabled]) => enabled).map(([provider]) => provider),
        keywords: stockKeywords.split(",").map((value) => value.trim()).filter(Boolean),
        negativeKeywords: stockNegativeKeywords.split(",").map((value) => value.trim()).filter(Boolean),
        category: randomize ? null : stockCategory || null,
        categoryId: randomize ? null : stockCategory || null,
        mood: stockMood || null,
        portraitOnly: stockPortraitOnly,
        minDurationSec: Math.min(15, duration),
        maxDurationSec: Math.max(15, duration * 3),
        avoidReuseWithinBatch: stockAvoidReuse,
        allowReuseWhenExhausted: stockAllowReuse,
      },
      seedanceSettings: { resolution: seedanceResolution },
      publishDefaults: { privacyLevel: publishPrivacy, disableDuet: true, disableStitch: true, disableComment: false },
      startAt: scheduledStart.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lyricTemplateId: lyricsSkipped ? null : lyricTemplateId || null,
    });
    setLastLaunchedAudioAssetId(response.audioAsset?.id ?? null);
    notifiedReadyRef.current = false;
    setStep("generating");
  }

  async function setItemTemplate(itemId: string, templateId: string | null) {
    await run("Update template", () => callCampaign("setLyricTemplate", { itemId, lyricTemplateId: templateId }));
  }

  const readyCount = activeItems.filter((item) => ["ready", "complete"].includes(item.status)).length;
  const totalCount = activeItems.length || postCount;
  const progress = totalCount ? Math.round((readyCount / totalCount) * 100) : 0;

  return (
    <div className="autopilot-panel stack">
      <header className="panel-title hero-title">
        <Sparkles size={20} />
        <div>
          <h2>FanAgent Autopilot</h2>
          <p>Guided audio-to-clips workflow for music-first fan pages.</p>
        </div>
      </header>

      {message ? <div className="banner">{message}</div> : null}

      {diagnostics ? (
        <section className="panel subtle-panel preflight-strip">
          <div className="batch-row"><span className={`dot ${schemaReady ? "good" : "bad"}`} /><div><strong>Database queue</strong><span>{diagnostics.schema.errors.length ? diagnostics.schema.errors.join(" · ") : "ready"}</span></div></div>
          <div className="batch-row"><span className={`dot ${diagnostics.env.pexels || diagnostics.env.pixabay || diagnostics.env.fal || diagnostics.env.gmi ? "good" : "bad"}`} /><div><strong>Providers</strong><span>stock {diagnostics.env.pexels || diagnostics.env.pixabay ? "ready" : "missing"} · fal {diagnostics.env.fal ? "ready" : "missing"}</span></div></div>
          <button className="button ghost" type="button" onClick={refreshDiagnostics}><RefreshCcw size={14} /> Refresh</button>
        </section>
      ) : null}

      <StepCard id="connect" index={1} title="Connect account" active={step === "connect"} complete={connectComplete} summary={account ? `${account.handle ?? account.tiktok_display_name ?? account.id.slice(0, 8)} · ${isConnected ? "TikTok connected" : "TikTok pending"}` : "Load or connect account"} onClick={setStep}>
        {account ? (
          <div className="stack">
            <div className="batch-row"><span className={`dot ${isConnected ? "good" : "warn"}`} /><div><strong>{account.handle ?? account.tiktok_display_name ?? account.id.slice(0, 8)}</strong><span>{isConnected ? "Connected for direct publishing" : "Generation works now; publishing waits for OAuth"}</span></div></div>
            {!isConnected ? <div className="banner warn">TikTok is not connected. You can proceed, but auto-posting waits for OAuth.</div> : null}
            <div className="action-row"><a className="button primary" href={tiktokConnectUrl(account.id)}><PlugZap size={16} /> {isConnected ? "Reconnect TikTok" : "Connect TikTok"}</a><button className="button ghost" type="button" onClick={() => setStep("upload")}>Proceed</button></div>
          </div>
        ) : <div className="empty-state">Loading primary TikTok account…</div>}
      </StepCard>

      <StepCard id="upload" index={2} title="Upload audio" active={step === "upload"} complete={uploadComplete} summary={trimmedAudio ? `${trimmedAudio.name} · ${trimmedAudio.durationSec.toFixed(0)}s` : "Drop audio, trim waveform, choose duration"} onClick={setStep}>
        <div className="stack">
          <label className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const f = event.dataTransfer.files?.[0] ?? null; if (f) { setAudioFile(f); setTrimmedAudio(null); } }}>
            <UploadCloud size={22} />
            <strong>Drag audio here or browse</strong>
            <span>MP3, WAV, M4A up to 12MB</span>
            <input type="file" accept="audio/*" onChange={(event) => { const f = event.target.files?.[0] ?? null; setAudioFile(f); setTrimmedAudio(null); }} />
          </label>
          <div className="action-row" style={{ flexWrap: "wrap", gap: 6 }}>{DURATIONS.map((d) => <button type="button" key={d} className={`button ${duration === d ? "primary" : "ghost"}`} onClick={() => { setDuration(d); setTrimmedAudio(null); }}>{d}s</button>)}</div>
          {audioFile ? <AudioTrimmer file={audioFile} maxDurationSec={duration} onTrimmed={(blob, selection) => setTrimmedAudio({ blob, name: audioFile.name, ...selection })} /> : null}
          {trimmedAudio ? <div className="banner good">Registered ✓ · transcribing in background · {trimmedAudio.startSec.toFixed(1)}s–{trimmedAudio.endSec.toFixed(1)}s</div> : null}
        </div>
      </StepCard>

      <StepCard id="lyrics" index={3} title="Lyric template" active={step === "lyrics"} complete={lyricsComplete} summary={lyricsSkipped ? "No captions · warning" : selectedTemplate ? `${selectedTemplate.title} · ${wordCount(selectedTemplate)} words · ${selectedTemplate.status === "saved" ? "Saved ✓" : selectedTemplate.status}` : "Select, create, or skip captions"} onClick={setStep}>
        <div className="stack">
          <label>Template<select value={lyricTemplateId} onChange={(event) => { setLyricsSkipped(false); setLyricTemplateId(event.target.value); }}><option value="">Choose lyric template…</option>{lyricTemplates.map((t) => <option key={t.id} value={t.id}>{t.title} ({(t.selection_duration_ms / 1000).toFixed(0)}s · {t.status})</option>)}</select></label>
          <div className="action-row"><Link className="button primary" to={lyricTemplateId ? `/lyrics/templates/${lyricTemplateId}` : "/lyrics/new"}><FileMusic size={14} /> Open editor</Link><Link className="button ghost" to="/lyrics/new">Create from this audio</Link><button type="button" className="button ghost" onClick={() => { setLyricsSkipped(true); setLyricTemplateId(""); setStep("category"); }}>Skip (no captions)</button></div>
          {lyricsSkipped ? <div className="banner warn">No lyric overlay will be burned into these clips.</div> : null}
        </div>
      </StepCard>

      <StepCard id="category" index={4} title="Clip category" active={step === "category"} complete={categoryComplete} summary={randomize ? "Randomized full pool" : stockCategory ? categoryLabel(stockCategory) : "Pick a visual pool"} onClick={setStep}>
        <CategoryPicker value={stockCategory} randomize={randomize} onChange={(id) => { setStockCategory(id); setStep("campaign"); }} onRandomizeChange={(enabled) => { setRandomize(enabled); if (enabled) { setStockCategory(""); setStep("campaign"); } }} poolCounts={diagnostics?.queueCounts ?? { basketball: 142, streamer: 84, stock: 320 }} />
      </StepCard>

      <StepCard id="campaign" index={5} title="Campaign settings" active={step === "campaign"} complete={campaignComplete} summary={`${postCount} videos · every ${cadenceMinutes}m · starting ${new Date(startAt).toLocaleDateString()}`} onClick={setStep}>
        <form className="stack" onSubmit={(event) => { event.preventDefault(); run("Campaign launch", startCampaign); }}>
          {!schemaReady ? <div className="banner bad">Database queue schema is not ready. Generation is blocked until the live migration is applied.</div> : null}
          <label>Theme / visual prompt<textarea rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
          <div className="split"><label>Video count<div className="stepper"><button type="button" className="button ghost" onClick={() => setPostCount((n) => Math.max(1, n - 1))}>−</button><input type="number" min={1} max={250} value={postCount} onChange={(event) => setPostCount(Number(event.target.value))} /><button type="button" className="button ghost" onClick={() => setPostCount((n) => Math.min(250, n + 1))}>+</button></div></label><label>Source<select value={sourceMode} onChange={(event) => setSourceMode(event.target.value as SourceMode)}><option value="stock">Stock footage</option><option value="mixed">Mixed: stock + Seedance 2</option><option value="seedance">Seedance 2 only</option><option value="gmi_seedance">GMI Seedance 2</option></select></label></div>
          <div className="split schedule-split"><label>First post<input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label><label>Cadence min<input type="number" min={5} max={10080} value={cadenceMinutes} onChange={(event) => setCadenceMinutes(Number(event.target.value))} /><span className="hint">{cadenceLabel(cadenceMinutes)}</span></label></div>
          <details className="panel subtle-panel"><summary>Advanced</summary><div className="stack"><div className="action-row" style={{ flexWrap: "wrap" }}>{(["library", "pexels", "pixabay"] as const).map((provider) => <label className="check" key={provider}><input type="checkbox" checked={stockProviders[provider]} onChange={(event) => setStockProviders((current) => ({ ...current, [provider]: event.target.checked }))} /> {provider}</label>)}<label className="check"><input type="checkbox" checked={stockPortraitOnly} onChange={(event) => setStockPortraitOnly(event.target.checked)} /> portrait only</label><label className="check"><input type="checkbox" checked={stockAvoidReuse} onChange={(event) => setStockAvoidReuse(event.target.checked)} /> avoid repeats</label><label className="check"><input type="checkbox" checked={stockAllowReuse} onChange={(event) => setStockAllowReuse(event.target.checked)} /> reuse if exhausted</label></div><div className="split"><label>Keywords<input value={stockKeywords} onChange={(event) => setStockKeywords(event.target.value)} placeholder="concert, neon, crowd" /></label><label>Avoid<input value={stockNegativeKeywords} onChange={(event) => setStockNegativeKeywords(event.target.value)} placeholder="logo, watermark" /></label></div><div className="split"><label>Mood<input value={stockMood} onChange={(event) => setStockMood(event.target.value)} placeholder="high energy" /></label><label>Seedance resolution<select value={seedanceResolution} onChange={(event) => setSeedanceResolution(event.target.value as "480p" | "720p" | "1080p")}><option value="480p">480p draft</option><option value="720p">720p balanced</option><option value="1080p">1080p final</option></select></label></div><label>TikTok privacy default<select value={publishPrivacy} onChange={(event) => setPublishPrivacy(event.target.value)}><option value="SELF_ONLY">SELF_ONLY</option><option value="MUTUAL_FOLLOW_FRIENDS">MUTUAL_FOLLOW_FRIENDS</option><option value="FOLLOWER_OF_CREATOR">FOLLOWER_OF_CREATOR</option><option value="PUBLIC_TO_EVERYONE">PUBLIC_TO_EVERYONE</option></select></label></div></details>
          <button className="button primary generate-button" disabled={busy || !canGenerate} type="submit">{busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />} Generate Library</button>
        </form>
      </StepCard>

      <StepCard id="generating" index={6} title="Generating" active={step === "generating" || activeBatches.length > 0} complete={readyCount >= totalCount && totalCount > 0} summary={`${readyCount}/${totalCount} ready`} onClick={setStep}>
        <div className="stack"><div className="progress-bar"><span style={{ width: `${progress}%` }} /></div><div className="action-row"><Link className="button primary" to={lastLaunchedAudioAssetId ? `/clips?audioClipId=${lastLaunchedAudioAssetId}` : "/clips"}>View in Clips</Link><button className="button ghost" type="button" onClick={() => run("Generation worker", () => callCampaign("runGenerationWorkers"))}><RefreshCcw size={14} /> Run worker</button></div><div className="batch-list">{activeItems.slice(0, 20).map((item) => { const post = data?.posts.find((p) => p.generation_item_id === item.id); const itemTpl = item.lyric_template_id ? templateById.get(item.lyric_template_id) : null; const segments = Array.isArray(item.segments) ? item.segments : []; const previewUrl = post?.video_url ?? item.stock_clip_url ?? segments.find((s) => s.url)?.url; return <div className="batch-row" key={item.id}><span className={`dot ${statusTone(item.status)}`} /><div style={{ flex: 1 }}><strong>{item.status}</strong><span>{new Date(item.scheduled_at).toLocaleString()} · {summarizeSegments(segments, item.provider ?? item.render_provider)}</span>{itemTpl ? <span className="status-pill"><FileMusic size={12} /> {itemTpl.title}</span> : null}{item.error_message ? <span className="status-pill bad">{item.error_message}</span> : null}</div>{previewUrl ? <a className="button ghost" href={previewUrl} target="_blank" rel="noreferrer">Preview</a> : null}<select value={item.lyric_template_id ?? ""} onChange={(event) => setItemTemplate(item.id, event.target.value || null)} disabled={busy}><option value="">No template</option>{lyricTemplates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select><button className="button ghost" type="button" disabled={busy} onClick={() => run("Regenerate", () => callCampaign("regenerate", { itemId: item.id }))}><RotateCcw size={14} /></button></div>; })}</div></div>
      </StepCard>

      {(data?.batches ?? []).filter((b) => !!b.paused_at).map((b) => <section className="panel" key={b.id}><div className="panel-title"><PauseCircle size={16} /><h3>Paused · {b.source_mode}</h3></div><button className="button" disabled={busy} onClick={() => run("Resume", () => callCampaign("resume", { batchId: b.id }))}><PlayCircle size={16} /> Resume</button></section>)}
    </div>
  );
}

