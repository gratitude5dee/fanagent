import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Home, Library, PlugZap, RefreshCcw, Search } from "lucide-react";
import { listAudioClips, type AudioClipSummary } from "@/lib/library/api";
import { displayError } from "@/lib/errors";

function clipTitle(summary: AudioClipSummary): string {
  return summary.clip.file_name || `Audio clip ${summary.clip.id.slice(0, 8)}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function LibraryLanding() {
  const [clips, setClips] = useState<AudioClipSummary[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      setClips(await listAudioClips());
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clips;
    return clips.filter((summary) => {
      const text = [
        summary.clip.file_name,
        summary.clip.transcription_status,
        summary.clip.duration_sec,
        summary.clip.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }, [clips, query]);

  return (
    <main className="app-shell library-shell">
      <header className="topbar">
        <div>
          <h1>Library</h1>
          <p>Reusable rendered clips grouped by uploaded audio.</p>
        </div>
        <div className="topbar-actions">
          <Link className="button ghost" to="/">
            <Home size={14} /> Home
          </Link>
          <Link className="button ghost" to="/settings/accounts">
            <PlugZap size={14} /> Accounts
          </Link>
          <button className="button ghost" type="button" disabled={busy} onClick={refresh}>
            <RefreshCcw className={busy ? "spin" : undefined} size={14} /> Refresh
          </button>
        </div>
      </header>

      {message ? <div className="banner bad">{message}</div> : null}

      <section className="panel library-overview">
        <div className="library-toolbar">
          <div className="panel-title">
            <Library size={16} />
            <h2>Audio clips</h2>
          </div>
          <label className="library-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search audio clips"
            />
          </label>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">No audio clips have generated library items yet.</div>
        ) : (
          <div className="library-clip-list">
            {filtered.map((summary) => (
              <Link
                className="library-clip-row"
                key={summary.clip.id}
                to={`/library/${summary.clip.id}`}
              >
                <div className="library-clip-thumb">
                  {summary.thumbnailUrl ? (
                    <img alt="" src={summary.thumbnailUrl} />
                  ) : (
                    <Library size={20} />
                  )}
                </div>
                <div>
                  <strong>{clipTitle(summary)}</strong>
                  <span>
                    {summary.clip.duration_sec}s · {summary.total} items · {summary.ready} ready ·{" "}
                    {summary.failed} failed
                  </span>
                </div>
                <div className="library-clip-meta">
                  <span>{summary.clip.transcription_status}</span>
                  <span>{formatDate(summary.updatedAt)}</span>
                </div>
                <ArrowRight size={16} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
