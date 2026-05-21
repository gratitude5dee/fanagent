import { useEffect, useMemo, useState } from "react";
import { Download, Filter, Play, RefreshCcw, RotateCcw, SlidersHorizontal } from "lucide-react";
import { fetchAllClips, type ClipGroup, type ClipItem } from "@/lib/clips/api";

const STATUS_FILTERS = ["all", "unscheduled", "scheduled", "posted", "failed"] as const;

function tone(status: string): string {
  if (["ready", "complete", "posted"].includes(status)) return "good";
  if (["failed", "skipped"].includes(status)) return "bad";
  if (["scheduled", "pending", "rendering", "generating", "planning"].includes(status)) return "warn";
  return "idle";
}

function ClipTile({ clip, selected, onSelect, onOpen }: { clip: ClipItem; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  return (
    <article className={`clip-tile ${selected ? "selected" : ""}`}>
      <label className="clip-select"><input type="checkbox" checked={selected} onChange={onSelect} /> Select</label>
      {clip.video_url ? (
        <video src={clip.video_url} poster={clip.thumbnail_url ?? undefined} muted loop playsInline preload="metadata" onMouseEnter={(event) => event.currentTarget.play().catch(() => {})} onMouseLeave={(event) => { event.currentTarget.pause(); event.currentTarget.currentTime = 0; }} onClick={onOpen} />
      ) : (
        <button type="button" className="clip-placeholder" onClick={onOpen}><Play size={22} /> Pending</button>
      )}
      <div className="clip-overlay"><span className={`status-pill ${tone(clip.status)}`}>{clip.status}</span>{clip.category_id ? <span className="status-pill">{clip.category_id}</span> : null}{clip.font_name ? <span className="status-pill">Font: {clip.font_name}</span> : null}</div>
      <div className="clip-actions"><button className="button ghost" type="button">Schedule</button><button className="button ghost" type="button"><RotateCcw size={13} /> Regenerate</button>{clip.video_url ? <a className="button ghost" href={clip.video_url} download><Download size={13} /> Download</a> : null}</div>
    </article>
  );
}

export default function ClipsPage() {
  const [groups, setGroups] = useState<ClipGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [category, setCategory] = useState("all");
  const [audioClipId, setAudioClipId] = useState(() => new URLSearchParams(window.location.search).get("audioClipId") ?? "all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openClip, setOpenClip] = useState<ClipItem | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setGroups(await fetchAllClips());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const categories = useMemo(() => Array.from(new Set(groups.flatMap((group) => group.items.map((item) => item.category_id).filter(Boolean)))) as string[], [groups]);
  const filteredGroups = useMemo(() => groups
    .filter((group) => audioClipId === "all" || group.audioClipId === audioClipId)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const statusOk = status === "all" || (status === "unscheduled" ? !item.scheduled_at : item.status === status);
        const categoryOk = category === "all" || item.category_id === category;
        return statusOk && categoryOk;
      }),
    }))
    .filter((group) => group.items.length > 0), [groups, audioClipId, status, category]);

  const allVisibleIds = filteredGroups.flatMap((group) => group.items.map((item) => item.id));

  return (
    <main className="app-shell clips-shell">
      <section className="app-main full-width">
        <header className="topbar clips-topbar"><div><h1>Clips</h1><p>All rendered videos grouped by audio source.</p></div><div className="topbar-actions"><button className="button ghost" type="button" onClick={load}><RefreshCcw size={14} /> Refresh</button></div></header>
        {error ? <div className="banner bad">{error}</div> : null}
        <section className="panel clips-toolbar"><div className="action-row"><Filter size={16} /><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{STATUS_FILTERS.map((value) => <option key={value} value={value}>{value}</option>)}</select><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select><select value={audioClipId} onChange={(event) => setAudioClipId(event.target.value)}><option value="all">All audio clips</option>{groups.map((group) => <option key={group.audioClipId} value={group.audioClipId}>{group.fileName}</option>)}</select></div><div className="action-row"><button className="button ghost" type="button" onClick={() => setSelected(new Set(allVisibleIds))}>Select all</button><button className="button primary" type="button" disabled={selected.size === 0}><SlidersHorizontal size={14} /> Schedule Selected ({selected.size})</button></div></section>
        {loading ? <div className="empty-state panel">Loading clips…</div> : null}
        <div className="clip-groups">{filteredGroups.map((group) => <section className="clip-group" key={group.audioClipId}><header><div><strong>Audio: {group.fileName} · {group.durationSec ?? "—"}s ({group.items.length} videos)</strong><span>{group.categoryId ?? "mixed"}</span></div><span className={`status-pill ${tone(group.status)}`}>{group.status}</span></header><div className="clip-grid">{group.items.map((clip) => <ClipTile key={clip.id} clip={clip} selected={selected.has(clip.id)} onOpen={() => setOpenClip(clip)} onSelect={() => setSelected((current) => { const next = new Set(current); if (next.has(clip.id)) next.delete(clip.id); else next.add(clip.id); return next; })} />)}</div></section>)}</div>
        {!loading && filteredGroups.length === 0 ? <div className="empty-state panel">No clips match these filters yet.</div> : null}
        {openClip ? <div className="modal-backdrop" onClick={() => setOpenClip(null)}><div className="modal-player" onClick={(event) => event.stopPropagation()}><button className="button ghost" type="button" onClick={() => setOpenClip(null)}>Close</button>{openClip.video_url ? <video src={openClip.video_url} controls autoPlay playsInline /> : <div className="empty-state">Clip is not rendered yet.</div>}</div></div> : null}
      </section>
    </main>
  );
}

