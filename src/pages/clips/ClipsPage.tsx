import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Film, RefreshCcw } from "lucide-react";
import LibraryTile from "@/components/library/LibraryTile";
import { fetchAllClipGroups, type ClipGroup } from "@/lib/clips/api";
import type { LibraryItem } from "@/lib/library/types";

type StatusFilter = "all" | "ready" | "scheduled" | "posted" | "failed" | "blocked";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "ready", label: "Unscheduled" },
  { key: "scheduled", label: "Scheduled" },
  { key: "posted", label: "Posted" },
  { key: "blocked", label: "Blocked" },
  { key: "failed", label: "Failed" },
];

function matchesStatus(item: LibraryItem, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  return item.status === filter;
}

export default function ClipsPage() {
  const [groups, setGroups] = useState<ClipGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [params] = useSearchParams();
  const focusAudioClipId = params.get("audioClipId");

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setGroups(await fetchAllClipGroups());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, []);

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => matchesStatus(item, statusFilter)),
        }))
        .filter((group) => group.items.length > 0)
        .sort((a, b) => {
          if (focusAudioClipId) {
            if (a.audioClip.id === focusAudioClipId) return -1;
            if (b.audioClip.id === focusAudioClipId) return 1;
          }
          return a.latestUpdatedAt < b.latestUpdatedAt ? 1 : -1;
        }),
    [groups, statusFilter, focusAudioClipId],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Clips</h1>
          <p>Every rendered video, grouped by audio</p>
        </div>
        <div className="topbar-actions">
          <button className="button ghost" type="button" disabled={busy} onClick={() => void refresh()}>
            <RefreshCcw size={14} className={busy ? "spin" : undefined} /> Refresh
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="panel-title">
          <Film size={16} />
          <h3>Filters</h3>
        </div>
        <div className="action-row" role="tablist" aria-label="Status filter">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`button ${statusFilter === filter.key ? "primary" : "ghost"}`}
              onClick={() => setStatusFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </section>

      {error ? <div className="banner bad">{error}</div> : null}

      {visibleGroups.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            {busy
              ? "Loading clips…"
              : "No rendered clips yet. Launch a campaign from Autopilot to see videos appear here."}
          </div>
        </section>
      ) : null}

      <div className="stack" style={{ gap: 16 }}>
        {visibleGroups.map((group) => (
          <section
            key={group.audioClip.id}
            className="panel clip-group"
            data-focused={group.audioClip.id === focusAudioClipId ? "true" : undefined}
          >
            <div className="panel-title" style={{ justifyContent: "space-between" }}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {group.audioClip.file_name || "Untitled audio"}
                </h3>
                <small style={{ opacity: 0.7 }}>
                  {group.audioClip.duration_sec}s · {group.items.length} video
                  {group.items.length === 1 ? "" : "s"}
                </small>
              </div>
              <Link className="button ghost" to={`/library/${group.audioClip.id}`}>
                Open in Library
              </Link>
            </div>
            <div className="library-grid">
              {group.items.map((item) => (
                <LibraryTile
                  key={item.id}
                  item={item}
                  selected={false}
                  onToggle={() => {}}
                  onRegenerate={() => {}}
                  onMarkUnfit={() => {}}
                  onReplaceSegment={() => {}}
                  onSchedule={() => {
                    window.location.href = `/library/${group.audioClip.id}`;
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
