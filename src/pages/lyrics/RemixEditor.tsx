import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Play, Pause, Sparkles, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/fanagent/invokeFunction";
import { lyricsApi } from "@/lib/lyrics/api";
import type { LyricTemplate, RemixRenderDefaults } from "@/lib/lyrics/types";
import { appRoutes } from "@/lib/routes";

type AccountOption = { id: string; handle: string | null; platform: string };

const DEFAULT_DEFAULTS: Required<
  Pick<
    RemixRenderDefaults,
    "lyricStyleId" | "scale" | "aspectRatio" | "sourceMode" | "prompt" | "quantity" | "cadenceMinutes"
  >
> = {
  lyricStyleId: "default",
  scale: 0.65,
  aspectRatio: "9:16",
  sourceMode: "stock",
  prompt: "music-driven fan edit with cinematic lifestyle visuals",
  quantity: 6,
  cadenceMinutes: 240,
};

export default function RemixEditor() {
  const { templateId } = useParams<{ templateId: string }>();
  const nav = useNavigate();
  const [template, setTemplate] = useState<LyricTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [draft, setDraft] = useState<RemixRenderDefaults>(DEFAULT_DEFAULTS);
  const [launching, setLaunching] = useState(false);
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const firstLoad = useRef(true);

  // Load template + audio + accounts
  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [tplRes, accRes] = await Promise.all([
          lyricsApi.get(templateId),
          supabase.from("accounts").select("id,handle,platform").order("is_primary", { ascending: false }),
        ]);
        if (cancelled) return;
        setTemplate(tplRes.template);
        setDraft({ ...DEFAULT_DEFAULTS, ...(tplRes.template.render_defaults ?? {}) });
        const accountRows = (accRes.data ?? []) as AccountOption[];
        setAccounts(accountRows);
        if (accountRows[0]) setAccountId(accountRows[0].id);

        const assetId = tplRes.template.trimmed_audio_asset_id;
        if (assetId) {
          const asset = await supabase
            .from("project_assets")
            .select("storage_bucket,storage_path,public_url")
            .eq("id", assetId)
            .maybeSingle();
          if (!cancelled && asset.data) {
            if (asset.data.public_url) {
              setAudioUrl(asset.data.public_url);
            } else {
              const signed = await supabase.storage
                .from(asset.data.storage_bucket)
                .createSignedUrl(asset.data.storage_path, 60 * 60);
              if (!cancelled && signed.data?.signedUrl) setAudioUrl(signed.data.signedUrl);
            }
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  // Debounced persist of render defaults
  useEffect(() => {
    if (!templateId || loading) return;
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const t = setTimeout(() => {
      lyricsApi
        .patchRenderDefaults(templateId, draft)
        .catch((e) => console.warn("patchRenderDefaults failed", e));
    }, 600);
    return () => clearTimeout(t);
  }, [draft, templateId, loading]);

  // Audio playback time tracking
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setTime(el.currentTime);
    const onEnded = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play();
      setPlaying(true);
    }
  };

  const update = useCallback(<K extends keyof RemixRenderDefaults>(key: K, value: RemixRenderDefaults[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const activeCaption = useMemo(() => {
    if (!template) return null;
    const timeMs = time * 1000;
    for (const block of template.lyric_blocks ?? []) {
      if (timeMs >= block.startTime * 1000 && timeMs <= block.endTime * 1000) {
        return block.words.map((w) => w.text).join(" ");
      }
    }
    return null;
  }, [template, time]);

  const durationSec = template ? template.selection_duration_ms / 1000 : 15;
  const progressPct = durationSec > 0 ? Math.min(100, (time / durationSec) * 100) : 0;

  async function launchGeneration() {
    if (!template || !templateId) return;
    if (!accountId) {
      setLaunchMessage("Connect or select an account to launch.");
      return;
    }
    setLaunching(true);
    setLaunchMessage(null);
    try {
      // Use fanpage-campaign which wraps create-generation-batch and kicks off
      // transcription + prompt generation. The edge function resolves
      // audioClipId from the template when not provided.
      const startAt = new Date(Date.now() + 5 * 60_000).toISOString();
      const res = await invokeEdgeFunction<{ batch?: { id: string } }>("fanpage-campaign", {
        action: "create",
        accountId,
        lyricTemplateId: templateId,
        sourceMode: draft.sourceMode,
        prompt: draft.prompt,
        quantity: draft.quantity,
        count: draft.quantity,
        postCount: draft.quantity,
        cadenceMinutes: draft.cadenceMinutes,
        durationSeconds: Math.round(durationSec),
        startAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        publishDefaults: {
          privacyLevel: "SELF_ONLY",
          disableDuet: true,
          disableStitch: true,
          disableComment: false,
        },
      });
      setLaunchMessage(
        res.batch?.id
          ? `Launched batch ${res.batch.id.slice(0, 8)}. Opening jobs…`
          : "Launched.",
      );
      setTimeout(() => nav(appRoutes.lyricsJobs(templateId)), 800);
    } catch (e) {
      setLaunchMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLaunching(false);
    }
  }

  if (loading) {
    return (
      <main className="page lyrics-remix">
        <div className="lyrics-loading">Loading template…</div>
      </main>
    );
  }
  if (error || !template) {
    return (
      <main className="page lyrics-remix">
        <header className="page-header">
          <Link to={appRoutes.lyricsHome} className="button ghost">
            <ChevronLeft size={14} /> Back
          </Link>
          <h1>Remix</h1>
          <span />
        </header>
        <div className="status-pill bad">{error ?? "Template not found"}</div>
      </main>
    );
  }

  if (template.status !== "saved") {
    return (
      <main className="page lyrics-remix">
        <header className="page-header">
          <Link to={appRoutes.lyricsHome} className="button ghost">
            <ChevronLeft size={14} /> Back
          </Link>
          <h1>Remix</h1>
          <span />
        </header>
        <div className="empty-state">
          <p>This template isn't saved yet. Finish the wizard to remix.</p>
          <button
            type="button"
            className="button primary"
            onClick={() => nav(appRoutes.lyricsTemplate(template.id))}
          >
            Open wizard
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="page lyrics-remix">
      <header className="page-header">
        <Link to={appRoutes.lyricsHome} className="button ghost">
          <ChevronLeft size={14} /> Back
        </Link>
        <h1>
          <Sparkles size={18} /> {template.title}
        </h1>
        <Link to={appRoutes.lyricsJobs(template.id)} className="button ghost">
          Jobs
        </Link>
      </header>

      <div className="lyrics-remix__grid">
        <section className="panel lyrics-remix__preview">
          <div className="panel-title">
            <h3>Preview</h3>
            <span className="status-pill idle">{Math.round(durationSec)}s</span>
          </div>
          <div
            className="remix-preview-stage"
            style={{
              aspectRatio:
                draft.aspectRatio === "1:1"
                  ? "1/1"
                  : draft.aspectRatio === "16:9"
                    ? "16/9"
                    : "9/16",
            }}
          >
            <div className="remix-preview-caption" style={{ transform: `scale(${draft.scale ?? 0.65})` }}>
              {activeCaption ?? <span className="muted">caption preview</span>}
            </div>
            {(template.cut_markers ?? []).map((ms, i) => {
              const pct = Math.min(100, (ms / 1000 / durationSec) * 100);
              return (
                <span key={i} className="remix-preview-cut" style={{ left: `${pct}%` }} aria-hidden />
              );
            })}
          </div>
          <div className="remix-preview-controls">
            <button type="button" className="button ghost" onClick={togglePlay} disabled={!audioUrl}>
              {playing ? <Pause size={14} /> : <Play size={14} />}
              {playing ? "Pause" : "Play"}
            </button>
            <div className="remix-preview-progress" aria-hidden>
              <span style={{ width: `${progressPct}%` }} />
            </div>
            <small>
              {time.toFixed(1)}s / {durationSec.toFixed(0)}s
            </small>
          </div>
          {audioUrl ? <audio ref={audioRef} src={audioUrl} preload="metadata" /> : null}
        </section>

        <section className="panel lyrics-remix__controls stack">
          <div className="panel-title">
            <h3>Generate</h3>
          </div>

          <label>
            Account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.length === 0 ? <option value="">No accounts connected</option> : null}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.handle ?? a.id.slice(0, 8)} ({a.platform})
                </option>
              ))}
            </select>
          </label>

          <label>
            Source mode
            <select
              value={draft.sourceMode}
              onChange={(e) => update("sourceMode", e.target.value as RemixRenderDefaults["sourceMode"])}
            >
              <option value="stock">Stock footage</option>
              <option value="seedance">Seedance (AI)</option>
              <option value="gmi_seedance">GMI Seedance</option>
              <option value="library">Reuse library</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>

          <label>
            Aspect ratio
            <select
              value={draft.aspectRatio}
              onChange={(e) =>
                update("aspectRatio", e.target.value as RemixRenderDefaults["aspectRatio"])
              }
            >
              <option value="9:16">9:16 vertical</option>
              <option value="1:1">1:1 square</option>
              <option value="16:9">16:9 widescreen</option>
            </select>
          </label>

          <label>
            Caption scale ({(draft.scale ?? 0.65).toFixed(2)})
            <input
              type="range"
              min={0.3}
              max={1.2}
              step={0.05}
              value={draft.scale ?? 0.65}
              onChange={(e) => update("scale", Number(e.target.value))}
            />
          </label>

          <label>
            Style preset
            <select
              value={draft.lyricStyleId}
              onChange={(e) => update("lyricStyleId", e.target.value)}
            >
              <option value="default">Default</option>
              <option value="bold-impact">Bold impact</option>
              <option value="minimal">Minimal</option>
              <option value="neon">Neon</option>
            </select>
          </label>

          <label>
            Prompt
            <textarea
              rows={3}
              value={draft.prompt}
              onChange={(e) => update("prompt", e.target.value)}
            />
          </label>

          <div className="row" style={{ display: "flex", gap: "1rem" }}>
            <label style={{ flex: 1 }}>
              Quantity
              <input
                type="number"
                min={1}
                max={50}
                value={draft.quantity ?? 6}
                onChange={(e) => update("quantity", Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <label style={{ flex: 1 }}>
              Cadence (min)
              <input
                type="number"
                min={5}
                step={5}
                value={draft.cadenceMinutes ?? 240}
                onChange={(e) =>
                  update("cadenceMinutes", Math.max(5, Number(e.target.value) || 60))
                }
              />
            </label>
          </div>

          {launchMessage ? <div className="status-pill idle">{launchMessage}</div> : null}

          <button
            type="button"
            className="button primary"
            disabled={launching || !accountId}
            onClick={() => void launchGeneration()}
          >
            <Wand2 size={14} />
            {launching ? "Launching…" : `Generate ${draft.quantity ?? 6} videos`}
          </button>
          {/* TODO(remotion): swap the DOM preview above with <Player component={LyricRemixComposition} ... />
              and route renders through a dedicated kanvas-lyrics-render edge + Node worker
              once the Remotion runtime is hosted externally. */}
        </section>
      </div>
    </main>
  );
}
