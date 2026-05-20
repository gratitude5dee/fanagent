import { useCallback, useEffect, useReducer, useState } from "react";
import { ChevronLeft, HelpCircle, Loader2, Save, Sparkles } from "lucide-react";
import AudioPanel from "@/pages/lyrics/panels/AudioPanel";
import LyricsPanel from "@/pages/lyrics/panels/LyricsPanel";
import MarkersPanel from "@/pages/lyrics/panels/MarkersPanel";
import { lyricsApi } from "@/lib/lyrics/api";
import { useAudioEngine } from "@/lib/lyrics/useAudioEngine";
import { useTrimmedAudioUrl } from "@/lib/lyrics/useTrimmedAudioUrl";
import type { LyricBlock, LyricTemplate } from "@/lib/lyrics/types";
import { statusToStep, type WizardStep } from "@/lib/lyrics/types";

export interface LyricsTemplateBuilderProps {
  templateId: string | null;
  onTemplateIdChange: (id: string | null) => void;
  onSaved: (template: LyricTemplate) => void;
  onClose: () => void;
}

type State = {
  templateId: string | null;
  template: LyricTemplate | null;
  previewUrl: string | null; // URL.createObjectURL for raw upload preview (step 1)
  loading: boolean;
  saving: boolean;
  error: string | null;
};

type Action =
  | { type: "reset"; templateId: string | null }
  | { type: "set_template"; template: LyricTemplate }
  | { type: "loading"; loading: boolean }
  | { type: "saving"; saving: boolean }
  | { type: "error"; error: string | null }
  | { type: "set_preview"; url: string | null }
  | { type: "patch"; patch: Partial<LyricTemplate> };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return {
        templateId: action.templateId,
        template: null,
        previewUrl: null,
        loading: !!action.templateId,
        saving: false,
        error: null,
      };
    case "set_template":
      return { ...state, template: action.template, templateId: action.template.id };
    case "loading":
      return { ...state, loading: action.loading };
    case "saving":
      return { ...state, saving: action.saving };
    case "error":
      return { ...state, error: action.error };
    case "set_preview":
      return { ...state, previewUrl: action.url };
    case "patch":
      return state.template
        ? { ...state, template: { ...state.template, ...action.patch } }
        : state;
    default:
      return state;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function audioClipIdFromTemplate(template: LyricTemplate): string | null {
  const transcriptMeta = recordValue(template.transcript_meta);
  const renderDefaults = recordValue(template.render_defaults);
  const candidates = [transcriptMeta?.audio_clip_id, renderDefaults?.audio_clip_id];
  const audioClipId = candidates.find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  );
  return audioClipId ?? null;
}

export default function LyricsTemplateBuilder({
  templateId,
  onTemplateIdChange,
  onSaved,
  onClose,
}: LyricsTemplateBuilderProps) {
  const [state, dispatch] = useReducer(reducer, {
    templateId,
    template: null,
    previewUrl: null,
    loading: !!templateId,
    saving: false,
    error: null,
  });
  const [step, setStep] = useState<WizardStep>(1);

  const engine = useAudioEngine();
  const { url: trimmedAudioUrl, error: trimmedError, retry: retryTrimmed } = useTrimmedAudioUrl(
    state.template,
  );

  // Drive the engine: trimmed audio takes precedence; otherwise raw upload preview.
  // IMPORTANT: do NOT include `engine` in deps — its identity changes every
  // playback tick (currentTime updates), which would cause this effect to
  // re-run constantly and pin the playhead back to 0.
  const engineLoad = engine.load;
  const engineSetLoop = engine.setLoop;
  useEffect(() => {
    if (trimmedAudioUrl) {
      engineLoad(trimmedAudioUrl);
      const clipSec = (state.template?.selection_duration_ms ?? 15000) / 1000;
      engineSetLoop(0, clipSec, { loop: true });
    } else if (state.previewUrl) {
      engineLoad(state.previewUrl);
    } else {
      engineLoad(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedAudioUrl, state.previewUrl, state.template?.selection_duration_ms]);

  useEffect(() => {
    onTemplateIdChange(state.templateId);
  }, [onTemplateIdChange, state.templateId]);

  useEffect(() => {
    dispatch({ type: "reset", templateId });
    setStep(1);
    if (!templateId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { template } = await lyricsApi.get(templateId);
        if (cancelled) return;

        let hydratedTemplate = template;
        if (!hydratedTemplate.trimmed_audio_asset_id) {
          const audioClipId = audioClipIdFromTemplate(hydratedTemplate);
          if (audioClipId) {
            const repaired = await lyricsApi.createFromAudioClip({ audioClipId });
            if (cancelled) return;
            hydratedTemplate = repaired.template;
          }
        }

        dispatch({ type: "set_template", template: hydratedTemplate });
        setStep(statusToStep(hydratedTemplate.status));
      } catch (error) {
        dispatch({ type: "error", error: error instanceof Error ? error.message : String(error) });
      } finally {
        dispatch({ type: "loading", loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  // Surface trimmed-url errors at the wizard level.
  useEffect(() => {
    if (trimmedError) dispatch({ type: "error", error: trimmedError });
  }, [trimmedError]);

  const onAudioConfirmed = useCallback(
    async (out: { template: LyricTemplate }) => {
      dispatch({ type: "set_template", template: out.template });
      dispatch({ type: "set_preview", url: null });
      setStep(2);
      try {
        const { template } = await lyricsApi.transcribe(out.template.id, false);
        dispatch({ type: "set_template", template });
      } catch (error) {
        dispatch({ type: "error", error: error instanceof Error ? error.message : String(error) });
      }
    },
    [],
  );

  const onPreviewUrl = useCallback((url: string | null) => {
    dispatch({ type: "set_preview", url });
  }, []);

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
    lyricsApi
      .patch(state.template.id, { cut_markers: markers })
      .catch((error) =>
        dispatch({ type: "error", error: error instanceof Error ? error.message : String(error) }),
      );
  }

  async function save() {
    if (!state.template) return;
    dispatch({ type: "saving", saving: true });
    try {
      const next = await lyricsApi.finalize(state.template.id);
      dispatch({ type: "set_template", template: next.template });
      onSaved(next.template);
    } catch (error) {
      dispatch({ type: "error", error: error instanceof Error ? error.message : String(error) });
    } finally {
      dispatch({ type: "saving", saving: false });
    }
  }

  const wordCount = (state.template?.lyric_blocks ?? []).reduce(
    (sum, block) => sum + (block.words?.length ?? 0),
    0,
  );
  const clipDuration = (state.template?.selection_duration_ms ?? 15000) / 1000;
  const canSave =
    !!state.template && !!state.template.trimmed_audio_asset_id && wordCount > 0 && !state.saving;

  return (
    <div className="lyrics-root">
      <header className="lyr-topbar">
        <div className="lyr-brand">
          <Sparkles size={16} /> WZRD<span>STUDIO</span>
          <em className="lyr-chip">ALPHA</em>
        </div>
        <button type="button" className="lyr-pill" onClick={onClose}>
          <ChevronLeft size={14} /> Back to templates
        </button>
      </header>

      <h1 className="lyr-page-title">CREATE TEMPLATE</h1>

      {state.loading ? <div className="lyr-banner">Loading template...</div> : null}
      {state.error ? (
        <div className="lyr-banner bad">
          {state.error}
          {trimmedError ? (
            <button type="button" className="lyr-btn" onClick={retryTrimmed}>
              Retry audio
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="lyr-wizard-grid">
        <section className={`lyr-wpanel ${step === 1 ? "active" : ""}`}>
          <header>
            <span className="lyr-step">1</span>
            <h2>Audio</h2>
          </header>
          <AudioPanel
            existing={state.template}
            engine={engine}
            hasTrimmedAudio={!!trimmedAudioUrl}
            onPreviewUrl={onPreviewUrl}
            onConfirmed={onAudioConfirmed}
            onError={(message) => dispatch({ type: "error", error: message })}
          />
        </section>

        <section className={`lyr-wpanel ${step === 2 ? "active" : ""}`}>
          <header>
            <span className="lyr-step">2</span>
            <h2>Lyrics</h2>
          </header>
          <LyricsPanel
            template={state.template}
            engine={engine}
            onDone={onLyricsDone}
            onRetry={async () => {
              if (!state.template) return;
              try {
                const { template } = await lyricsApi.transcribe(state.template.id, true);
                dispatch({ type: "set_template", template });
              } catch (error) {
                dispatch({
                  type: "error",
                  error: error instanceof Error ? error.message : String(error),
                });
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
            engine={engine}
            onChange={onMarkersChange}
          />
        </section>
      </div>

      <footer className="lyr-footer">
        <div className="lyr-stepper">
          {[1, 2, 3].map((stepNumber) => (
            <span key={stepNumber} className={`lyr-dot ${step >= stepNumber ? "on" : ""}`}>
              {stepNumber}
            </span>
          ))}
        </div>
        <div className="lyr-footer__meta">
          <span>{clipDuration}s clip</span>
          <span>{wordCount} words</span>
        </div>
        <button type="button" className="lyr-btn primary" disabled={!canSave} onClick={save}>
          {state.saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />} SAVE TEMPLATE
        </button>
      </footer>

      <button type="button" className="lyr-help" aria-label="Help">
        <HelpCircle size={20} />
      </button>

      {state.saving ? (
        <div className="lyr-overlay">
          <Loader2 className="spin" size={28} />
          <span>Saving template...</span>
        </div>
      ) : null}
    </div>
  );
}
