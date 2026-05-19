import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, HelpCircle, Loader2, Save, Sparkles } from "lucide-react";
import AudioPanel from "./panels/AudioPanel";
import LyricsPanel from "./panels/LyricsPanel";
import MarkersPanel from "./panels/MarkersPanel";
import { lyricsApi } from "@/lib/lyrics/api";
import type { LyricBlock, LyricTemplate, TemplateStatus } from "@/lib/lyrics/types";
import { statusToStep } from "@/lib/lyrics/types";
import { supabase } from "@/integrations/supabase/client";

type State = {
  templateId: string | null;
  template: LyricTemplate | null;
  trimmedAudioUrl: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

type Action =
  | { type: "set_template"; template: LyricTemplate }
  | { type: "loading"; loading: boolean }
  | { type: "saving"; saving: boolean }
  | { type: "error"; error: string | null }
  | { type: "set_audio_url"; url: string | null }
  | { type: "patch"; patch: Partial<LyricTemplate> };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set_template":
      return { ...state, template: action.template, templateId: action.template.id };
    case "loading":
      return { ...state, loading: action.loading };
    case "saving":
      return { ...state, saving: action.saving };
    case "error":
      return { ...state, error: action.error };
    case "set_audio_url":
      return { ...state, trimmedAudioUrl: action.url };
    case "patch":
      return state.template
        ? { ...state, template: { ...state.template, ...action.patch } as LyricTemplate }
        : state;
    default:
      return state;
  }
}

export default function LyricsWizard() {
  const params = useParams<{ templateId?: string }>();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, {
    templateId: params.templateId ?? null,
    template: null,
    trimmedAudioUrl: null,
    loading: !!params.templateId,
    saving: false,
    error: null,
  });
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Hydrate existing template
  useEffect(() => {
    if (!params.templateId) return;
    let cancelled = false;
    (async () => {
      try {
        const { template } = await lyricsApi.get(params.templateId!);
        if (cancelled) return;
        dispatch({ type: "set_template", template });
        setStep(statusToStep(template.status));
        if (template.trimmed_audio_asset_id) {
          // Generate signed URL via storage SDK
          const { data: asset } = await supabase
            .from("project_assets")
            .select("storage_bucket,storage_path")
            .eq("id", template.trimmed_audio_asset_id)
            .maybeSingle();
          if (asset) {
            const { data: signed } = await supabase.storage
              .from(asset.storage_bucket)
              .createSignedUrl(asset.storage_path, 3600);
            if (signed?.signedUrl) dispatch({ type: "set_audio_url", url: signed.signedUrl });
          }
        }
      } catch (e) {
        dispatch({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        dispatch({ type: "loading", loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.templateId]);

  const onAudioConfirmed = useCallback(
    async (out: { template: LyricTemplate; signedUrl: string }) => {
      dispatch({ type: "set_template", template: out.template });
      dispatch({ type: "set_audio_url", url: out.signedUrl });
      setStep(2);
      navigate(`/lyrics/templates/${out.template.id}`, { replace: true });
      // Kick off transcription
      try {
        const { template } = await lyricsApi.transcribe(out.template.id, false);
        dispatch({ type: "set_template", template });
      } catch (e) {
        dispatch({ type: "error", error: e instanceof Error ? e.message : String(e) });
      }
    },
    [navigate],
  );

  async function onLyricsDone(blocks: LyricBlock[]) {
    if (!state.template) return;
    const next = await lyricsApi.patch(state.template.id, {
      lyric_blocks: blocks,
      status: "lyrics_ready",
    });
    dispatch({ type: "set_template", template: next.template });
    setStep(3);
  }

  async function onMarkersChange(markers: number[]) {
    if (!state.template) return;
    dispatch({ type: "patch", patch: { cut_markers: markers } });
    // Debounce-light: fire and forget
    lyricsApi
      .patch(state.template.id, { cut_markers: markers })
      .catch((e) => dispatch({ type: "error", error: e instanceof Error ? e.message : String(e) }));
  }

  async function save() {
    if (!state.template) return;
    dispatch({ type: "saving", saving: true });
    try {
      const next = await lyricsApi.finalize(state.template.id);
      dispatch({ type: "set_template", template: next.template });
      navigate("/lyrics");
    } catch (e) {
      dispatch({ type: "error", error: e instanceof Error ? e.message : String(e) });
    } finally {
      dispatch({ type: "saving", saving: false });
    }
  }

  const wordCount = (state.template?.lyric_blocks ?? []).reduce(
    (s, b) => s + (b.words?.length ?? 0),
    0,
  );
  const clipDur = (state.template?.selection_duration_ms ?? 15000) / 1000;
  const canSave =
    !!state.template && !!state.template.trimmed_audio_asset_id && wordCount > 0 && !state.saving;

  return (
    <div className="lyrics-root">
      <header className="lyr-topbar">
        <Link to="/lyrics" className="lyr-brand">
          <Sparkles size={16} /> WZRD<span>STUDIO</span>
          <em className="lyr-chip">ALPHA</em>
        </Link>
        <Link to="/lyrics" className="lyr-pill">
          <ChevronLeft size={14} /> Back to templates
        </Link>
      </header>

      <h1 className="lyr-page-title">CREATE TEMPLATE</h1>

      {state.error ? <div className="lyr-banner bad">{state.error}</div> : null}

      <div className="lyr-wizard-grid">
        <section className={`lyr-wpanel ${step === 1 ? "active" : ""}`}>
          <header>
            <span className="lyr-step">1</span>
            <h2>Audio</h2>
          </header>
          <AudioPanel
            existing={state.template}
            existingAudioUrl={state.trimmedAudioUrl}
            onConfirmed={onAudioConfirmed}
            onError={(m) => dispatch({ type: "error", error: m })}
          />
        </section>

        <section className={`lyr-wpanel ${step === 2 ? "active" : ""}`}>
          <header>
            <span className="lyr-step">2</span>
            <h2>Lyrics</h2>
          </header>
          <LyricsPanel
            template={state.template}
            audioUrl={state.trimmedAudioUrl}
            audioElRef={audioElRef}
            onDone={onLyricsDone}
            onRetry={async () => {
              if (!state.template) return;
              try {
                const { template } = await lyricsApi.transcribe(state.template.id, true);
                dispatch({ type: "set_template", template });
              } catch (e) {
                dispatch({ type: "error", error: e instanceof Error ? e.message : String(e) });
              }
            }}
          />
        </section>

        <section className={`lyr-wpanel ${step === 3 ? "active" : ""}`}>
          <header>
            <span className="lyr-step">3</span>
            <h2>Cut Markers</h2>
          </header>
          <MarkersPanel
            active={step === 3}
            template={state.template}
            audioUrl={state.trimmedAudioUrl}
            onChange={onMarkersChange}
          />
        </section>
      </div>

      <footer className="lyr-footer">
        <div className="lyr-stepper">
          {[1, 2, 3].map((n) => (
            <span key={n} className={`lyr-dot ${step >= n ? "on" : ""}`}>
              {n}
            </span>
          ))}
        </div>
        <div className="lyr-footer__meta">
          <span>{clipDur}s clip</span>
          <span>{wordCount} words</span>
        </div>
        <button className="lyr-btn primary" disabled={!canSave} onClick={save}>
          {state.saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />} SAVE TEMPLATE
        </button>
      </footer>

      <button className="lyr-help" aria-label="Help">
        <HelpCircle size={20} />
      </button>

      {state.saving ? (
        <div className="lyr-overlay">
          <Loader2 className="spin" size={28} />
          <span>Saving template…</span>
        </div>
      ) : null}
    </div>
  );
}
