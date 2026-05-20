import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ChevronLeft, FileMusic, Plus } from "lucide-react";
import LyricsTemplateBuilder from "@/components/autopilot/LyricsTemplateBuilder";
import { lyricsApi } from "@/lib/lyrics/api";
import type { LyricTemplate, LyricTemplateSummary, TemplateStatus } from "@/lib/lyrics/types";

type LyricsStepProps = {
  lyricTemplateId: string;
  lyricTemplates: LyricTemplateSummary[];
  drawerOpen: boolean;
  onDrawerOpen: (open: boolean) => void;
  onTemplate: (templateId: string) => void;
  onTemplatesChanged: () => Promise<void> | void;
  autoOpenTemplateRequest?: number;
};

function statusPill(status: TemplateStatus): { label: string; tone: string } {
  switch (status) {
    case "saved":
      return { label: "Saved", tone: "good" };
    case "archived":
      return { label: "Archived", tone: "muted" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    case "lyrics_processing":
      return { label: "Transcribing", tone: "warn" };
    case "draft":
      return { label: "Draft", tone: "muted" };
    default:
      return { label: "In progress", tone: "warn" };
  }
}

function MiniWaveform() {
  const data = Array.from(
    { length: 40 },
    (_, index) => Math.abs(Math.sin(index * 0.7)) * 0.7 + 0.2,
  );
  return (
    <div className="lyr-card__wave" aria-hidden>
      {data.map((value, index) => (
        <span key={index} style={{ height: `${Math.max(8, value * 100)}%` }} />
      ))}
    </div>
  );
}

export function LyricsStep({
  lyricTemplateId,
  lyricTemplates,
  drawerOpen,
  onDrawerOpen,
  onTemplate,
  onTemplatesChanged,
  autoOpenTemplateRequest = 0,
}: LyricsStepProps) {
  const [builderTemplateId, setBuilderTemplateId] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [busyArchiveId, setBusyArchiveId] = useState<string | null>(null);
  const handledAutoOpenRequest = useRef(0);
  const selectedTemplate = useMemo(
    () => lyricTemplates.find((template) => template.id === lyricTemplateId) ?? null,
    [lyricTemplateId, lyricTemplates],
  );
  const activeTemplate = useMemo(
    () => lyricTemplates.find((template) => template.id === builderTemplateId) ?? null,
    [builderTemplateId, lyricTemplates],
  );
  const recentTemplates = lyricTemplates
    .filter((template) => template.status !== "archived")
    .slice(0, 6);
  const hasGeneratedTemplateToReview =
    !!lyricTemplateId && (!selectedTemplate || selectedTemplate.status !== "saved");

  function openBuilder(templateId: string | null) {
    setBuilderTemplateId(templateId);
    setBuilderOpen(true);
  }

  function closeBuilder() {
    setBuilderOpen(false);
    setBuilderTemplateId(null);
  }

  async function archiveTemplate(templateId: string) {
    setBusyArchiveId(templateId);
    try {
      await lyricsApi.archive(templateId);
      if (lyricTemplateId === templateId) onTemplate("");
      await onTemplatesChanged();
    } finally {
      setBusyArchiveId(null);
    }
  }

  async function handleSaved(template: LyricTemplate) {
    onTemplate(template.id);
    await onTemplatesChanged();
    closeBuilder();
  }

  useEffect(() => {
    if (!autoOpenTemplateRequest || autoOpenTemplateRequest === handledAutoOpenRequest.current) {
      return;
    }
    handledAutoOpenRequest.current = autoOpenTemplateRequest;
    if (lyricTemplateId) openBuilder(lyricTemplateId);
  }, [autoOpenTemplateRequest, lyricTemplateId]);

  if (builderOpen) {
    return (
      <section className="panel lyrics-step--builder">
        <div className="panel-title">
          <FileMusic size={16} />
          <h3>3. Lyrics template</h3>
        </div>
        <div className="action-row">
          <button type="button" className="button ghost" onClick={closeBuilder}>
            <ChevronLeft size={14} /> Back to templates
          </button>
          <span className="status-pill idle">{activeTemplate?.title ?? "New lyric template"}</span>
        </div>
        <LyricsTemplateBuilder
          templateId={builderTemplateId}
          onTemplateIdChange={setBuilderTemplateId}
          onSaved={handleSaved}
          onClose={closeBuilder}
        />
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <FileMusic size={16} />
        <h3>3. Lyrics template</h3>
      </div>
      <div className="stack">
        <div className="action-row">
          {hasGeneratedTemplateToReview ? (
            <button
              type="button"
              className="button primary"
              onClick={() => openBuilder(lyricTemplateId)}
            >
              <FileMusic size={14} /> Review generated template
            </button>
          ) : (
            <button type="button" className="button primary" onClick={() => openBuilder(null)}>
              <Plus size={14} /> New template
            </button>
          )}
          <button
            type="button"
            className="button ghost"
            onClick={() => openBuilder(lyricTemplateId)}
            disabled={!lyricTemplateId}
          >
            Edit selected
          </button>
          <button className="button ghost" type="button" onClick={() => onDrawerOpen(!drawerOpen)}>
            {drawerOpen ? "Hide review" : "Review lyrics"}
          </button>
          {hasGeneratedTemplateToReview ? (
            <button type="button" className="button ghost" onClick={() => openBuilder(null)}>
              <Plus size={14} /> New blank template
            </button>
          ) : null}
        </div>
        <label>
          Lyrics template
          <select value={lyricTemplateId} onChange={(event) => onTemplate(event.target.value)}>
            <option value="">None - basic captions only</option>
            {lyricTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.title} ({(template.selection_duration_ms / 1000).toFixed(0)}s -{" "}
                {template.status})
              </option>
            ))}
          </select>
        </label>

        <div className="lyr-grid">
          {recentTemplates.length === 0 ? (
            <div className="lyr-empty">
              <button type="button" className="lyr-btn primary" onClick={() => openBuilder(null)}>
                Create template
              </button>
            </div>
          ) : (
            recentTemplates.map((template) => {
              const pill = statusPill(template.status);
              const isSaved = template.status === "saved";
              return (
                <article key={template.id} className="lyr-card">
                  <MiniWaveform />
                  <div className="lyr-card__body">
                    <header>
                      <span className={`lyr-status ${pill.tone}`}>{pill.label}</span>
                      <button
                        type="button"
                        className="lyr-icon"
                        onClick={() => void archiveTemplate(template.id)}
                        disabled={busyArchiveId === template.id}
                        aria-label="Archive"
                      >
                        <Archive size={14} />
                      </button>
                    </header>
                    <h3>{template.title}</h3>
                    <small>updated {new Date(template.updated_at).toLocaleString()}</small>
                    <div className="lyr-meta">
                      <span>{Math.round(template.selection_duration_ms / 1000)}s</span>
                      <span>{template.status}</span>
                    </div>
                    <div className="lyr-card__actions">
                      <button
                        type="button"
                        className="lyr-btn primary"
                        onClick={() => openBuilder(template.id)}
                      >
                        {isSaved ? "Open" : "Continue"}
                      </button>
                      {isSaved ? (
                        <button
                          type="button"
                          className="lyr-btn"
                          onClick={() => openBuilder(template.id)}
                        >
                          Remix
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {drawerOpen ? (
          <div className="lyrics-drawer subtle-panel">
            <div className="panel-title">
              <FileMusic size={14} />
              <h4>Lyric review</h4>
            </div>
            {lyricTemplates.length === 0 ? (
              <div className="empty-state">
                Create or open a template to review transcription blocks before generating videos.
              </div>
            ) : (
              <div className="batch-list">
                {lyricTemplates.slice(0, 5).map((template) => (
                  <div className="batch-row" key={template.id}>
                    <span
                      className={`dot ${
                        template.status === "saved"
                          ? "good"
                          : template.status === "failed"
                            ? "bad"
                            : "warn"
                      }`}
                    />
                    <div style={{ flex: 1 }}>
                      <strong>{template.title}</strong>
                      <span>
                        {template.status} - {(template.selection_duration_ms / 1000).toFixed(1)}s
                      </span>
                    </div>
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => openBuilder(template.id)}
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
