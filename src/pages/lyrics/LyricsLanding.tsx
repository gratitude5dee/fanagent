import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, ArrowRight, FilePlus2, Music4, Search, Sparkles } from "lucide-react";
import { lyricsApi } from "@/lib/lyrics/api";
import type { LyricTemplate, TemplateStatus } from "@/lib/lyrics/types";

const FILTERS: Array<{ key: "all" | "in_progress" | "saved" | "archived"; label: string }> = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "In progress" },
  { key: "saved", label: "Saved" },
  { key: "archived", label: "Archived" },
];

const PRESETS = [
  { name: "Gothic Storm", grad: "linear-gradient(135deg,#1a1f2e,#0b0e14 60%,#3b0764)" },
  { name: "R&B Glass", grad: "linear-gradient(135deg,#0f172a,#155e75 60%,#0891b2)" },
  { name: "Rooftop Motion", grad: "linear-gradient(135deg,#1c1917,#7c2d12 60%,#f97316)" },
  { name: "Animated Rain", grad: "linear-gradient(135deg,#020617,#1e3a8a 60%,#22d3ee)" },
];

function statusPill(s: TemplateStatus): { label: string; tone: string } {
  switch (s) {
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

function MiniWaveform({ peaks }: { peaks: number[] }) {
  const data = peaks.length
    ? peaks
    : Array.from({ length: 40 }, (_, i) => Math.abs(Math.sin(i * 0.7)) * 0.7 + 0.2);
  return (
    <div className="lyr-card__wave" aria-hidden>
      {data.slice(0, 64).map((v, i) => (
        <span key={i} style={{ height: `${Math.max(8, v * 100)}%` }} />
      ))}
    </div>
  );
}

export default function LyricsLanding() {
  const [templates, setTemplates] = useState<LyricTemplate[]>([]);
  const [filter, setFilter] = useState<"all" | "in_progress" | "saved" | "archived">("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const { templates: t } = await lyricsApi.list();
      setTemplates(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (filter === "saved" && t.status !== "saved") return false;
      if (filter === "archived" && t.status !== "archived") return false;
      if (filter === "in_progress" && ["saved", "archived"].includes(t.status)) return false;
      if (query && !t.title.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [templates, filter, query]);

  async function archive(id: string) {
    setBusy(true);
    try {
      await lyricsApi.archive(id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lyrics-root">
      <header className="lyr-topbar">
        <Link to="/" className="lyr-brand">
          <Sparkles size={16} /> WZRD<span>STUDIO</span>
          <em className="lyr-chip">ALPHA</em>
        </Link>
        <nav className="lyr-nav">
          <Link className="lyr-pill active" to="/lyrics">
            <Music4 size={14} /> Lyrics
          </Link>
          <Link className="lyr-pill" to="/">
            Home
          </Link>
        </nav>
      </header>

      <section className="lyr-hero">
        <span className="lyr-badge">Lyric Templates</span>
        <h1 className="lyr-h1" aria-label="Your templates">
          LYRIC VISUAL PLATES
        </h1>
        <p className="lyr-sub">Reusable music-video templates · Audio · Lyrics · Markers</p>
      </section>

      <Link to="/lyrics/new" className="lyr-create">
        <div className="lyr-create__inner">
          <FilePlus2 size={26} />
          <div>
            <strong>Create new template</strong>
            <span>Upload a song, trim a 15/30/45/60s clip, sync lyrics, place markers.</span>
          </div>
          <ArrowRight size={22} />
        </div>
      </Link>

      <section className="lyr-toolbar">
        <div className="lyr-search">
          <Search size={14} />
          <input
            placeholder="Search templates"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="lyr-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`lyr-pill ${filter === f.key ? "active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      <section className="lyr-presets">
        {PRESETS.map((p) => (
          <div key={p.name} className="lyr-preset" style={{ background: p.grad }}>
            <span>{p.name}</span>
          </div>
        ))}
      </section>

      {error ? <div className="lyr-banner bad">{error}</div> : null}

      {filtered.length === 0 ? (
        <section className="lyr-empty">
          <div className="lyr-empty__grid">
            {PRESETS.map((p) => (
              <div key={p.name} className="lyr-preset" style={{ background: p.grad }}>
                <span>{p.name}</span>
              </div>
            ))}
          </div>
          <Link to="/lyrics/new" className="lyr-btn primary">
            Create template
          </Link>
        </section>
      ) : (
        <section className="lyr-grid">
          {filtered.map((t) => {
            const pill = statusPill(t.status);
            const wordCount = (t.lyric_blocks ?? []).reduce(
              (s, b) => s + (b.words?.length ?? 0),
              0,
            );
            const cuts = (t.cut_markers ?? []).length;
            const isSaved = t.status === "saved";
            return (
              <article key={t.id} className="lyr-card">
                <MiniWaveform peaks={t.waveform_peaks ?? []} />
                <div className="lyr-card__body">
                  <header>
                    <span className={`lyr-status ${pill.tone}`}>{pill.label}</span>
                    <button
                      className="lyr-icon"
                      onClick={() => archive(t.id)}
                      disabled={busy}
                      aria-label="Archive"
                    >
                      <Archive size={14} />
                    </button>
                  </header>
                  <h3>{t.title}</h3>
                  <small>updated {new Date(t.updated_at).toLocaleString()}</small>
                  <div className="lyr-meta">
                    <span>{Math.round(t.selection_duration_ms / 1000)}s</span>
                    <span>{wordCount} words</span>
                    <span>{cuts} cuts</span>
                  </div>
                  <div className="lyr-card__actions">
                    <Link className="lyr-btn primary" to={`/lyrics/templates/${t.id}`}>
                      {isSaved ? "Open" : "Continue"}
                    </Link>
                    {isSaved ? (
                      <Link className="lyr-btn" to={`/lyrics/templates/${t.id}`}>
                        Remix
                      </Link>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section className="lyr-how">
        <h2>How it works</h2>
        <ol>
          <li>
            <strong>1.</strong> Upload audio &amp; trim a 15/30/45/60s clip.
          </li>
          <li>
            <strong>2.</strong> Sync lyrics with AI transcription or manual entry.
          </li>
          <li>
            <strong>3.</strong> Place cut markers on every beat that matters.
          </li>
        </ol>
      </section>
    </div>
  );
}
