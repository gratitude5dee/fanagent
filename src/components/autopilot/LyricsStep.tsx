import { Link } from "react-router-dom";
import { FileMusic, Plus } from "lucide-react";
import type { LyricTemplateSummary } from "@/lib/lyrics/types";

type LyricsStepProps = {
  lyricTemplateId: string;
  lyricTemplates: LyricTemplateSummary[];
  drawerOpen: boolean;
  onDrawerOpen: (open: boolean) => void;
  onTemplate: (templateId: string) => void;
};

export function LyricsStep({
  lyricTemplateId,
  lyricTemplates,
  drawerOpen,
  onDrawerOpen,
  onTemplate,
}: LyricsStepProps) {
  return (
    <section className="panel">
      <div className="panel-title">
        <FileMusic size={16} />
        <h3>3. Lyrics template</h3>
      </div>
      <div className="stack">
        <div className="action-row">
          <Link className="button primary" to="/lyrics/new">
            <Plus size={14} /> New template
          </Link>
          <Link className="button ghost" to="/lyrics">
            Open builder
          </Link>
          <button className="button ghost" type="button" onClick={() => onDrawerOpen(!drawerOpen)}>
            {drawerOpen ? "Hide review" : "Review lyrics"}
          </button>
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
                    <Link className="button ghost" to={`/lyrics/templates/${template.id}`}>
                      Edit
                    </Link>
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
