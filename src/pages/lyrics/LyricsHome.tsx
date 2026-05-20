import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Archive, ChevronLeft, FileMusic, Plus } from "lucide-react";
import { lyricsApi } from "@/lib/lyrics/api";
import type { LyricTemplate } from "@/lib/lyrics/types";
import { appRoutes } from "@/lib/routes";

function statusTone(status: string): string {
  if (status === "saved") return "good";
  if (status === "failed") return "bad";
  if (status === "archived") return "muted";
  if (status === "lyrics_processing") return "warn";
  return "warn";
}

export default function LyricsHome() {
  const nav = useNavigate();
  const [templates, setTemplates] = useState<LyricTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await lyricsApi.list();
      setTemplates(res.templates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openTemplate(template: LyricTemplate) {
    nav(
      template.status === "saved"
        ? appRoutes.lyricsRemix(template.id)
        : appRoutes.lyricsTemplate(template.id),
    );
  }

  async function archiveTemplate(id: string) {
    setBusyId(id);
    try {
      await lyricsApi.archive(id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const visible = templates.filter((t) => t.status !== "archived");

  return (
    <main className="page lyrics-home">
      <header className="page-header">
        <Link to={appRoutes.home} className="button ghost">
          <ChevronLeft size={14} /> Back
        </Link>
        <h1>
          <FileMusic size={18} /> Lyrics templates
        </h1>
        <button
          type="button"
          className="button primary"
          onClick={() => nav(appRoutes.lyricsNew)}
        >
          <Plus size={14} /> New template
        </button>
      </header>

      {error ? <div className="status-pill bad">{error}</div> : null}
      {loading ? (
        <div className="lyrics-loading">Loading templates…</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <p>No templates yet.</p>
          <button
            type="button"
            className="button primary"
            onClick={() => nav(appRoutes.lyricsNew)}
          >
            <Plus size={14} /> Create your first template
          </button>
        </div>
      ) : (
        <div className="lyr-grid">
          {visible.map((t) => (
            <article key={t.id} className="lyr-card">
              <div className="lyr-card__body">
                <header>
                  <span className={`lyr-status ${statusTone(t.status)}`}>{t.status}</span>
                  <button
                    type="button"
                    className="lyr-icon"
                    onClick={() => void archiveTemplate(t.id)}
                    disabled={busyId === t.id}
                    aria-label="Archive"
                  >
                    <Archive size={14} />
                  </button>
                </header>
                <h3>{t.title}</h3>
                <small>updated {new Date(t.updated_at).toLocaleString()}</small>
                <div className="lyr-meta">
                  <span>{Math.round(t.selection_duration_ms / 1000)}s</span>
                  <span>{t.lyric_blocks?.length ?? 0} blocks</span>
                </div>
                <div className="lyr-card__actions">
                  <button
                    type="button"
                    className="lyr-btn primary"
                    onClick={() => openTemplate(t)}
                  >
                    {t.status === "saved" ? "Open remix" : "Continue"}
                  </button>
                  {t.status === "saved" ? (
                    <button
                      type="button"
                      className="lyr-btn"
                      onClick={() => nav(appRoutes.lyricsJobs(t.id))}
                    >
                      Jobs
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
