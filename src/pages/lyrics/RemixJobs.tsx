import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { appRoutes } from "@/lib/routes";

type BatchRow = {
  id: string;
  status: string;
  source_mode: string;
  quantity: number;
  cadence_minutes: number;
  created_at: string;
  paused_at: string | null;
  completed_at: string | null;
};

type LibraryCounts = {
  total: number;
  ready: number;
  scheduled: number;
  posted: number;
};

export default function RemixJobs() {
  const { templateId } = useParams<{ templateId: string }>();
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [counts, setCounts] = useState<Record<string, LibraryCounts>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const b = await supabase
          .from("generation_batches")
          .select(
            "id,status,source_mode,quantity,cadence_minutes,created_at,paused_at,completed_at",
          )
          .eq("lyric_template_id", templateId)
          .order("created_at", { ascending: false });
        if (b.error) throw b.error;
        if (cancelled) return;
        const rows = (b.data ?? []) as BatchRow[];
        setBatches(rows);

        if (rows.length) {
          const lib = await supabase
            .from("video_library_items")
            .select("batch_id,status")
            .in(
              "batch_id",
              rows.map((r) => r.id),
            );
          if (!cancelled && lib.data) {
            const next: Record<string, LibraryCounts> = {};
            for (const row of lib.data as { batch_id: string; status: string }[]) {
              const c = next[row.batch_id] ?? { total: 0, ready: 0, scheduled: 0, posted: 0 };
              c.total += 1;
              if (row.status === "ready") c.ready += 1;
              if (row.status === "scheduled") c.scheduled += 1;
              if (row.status === "posted") c.posted += 1;
              next[row.batch_id] = c;
            }
            setCounts(next);
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

  return (
    <main className="page lyrics-jobs">
      <header className="page-header">
        <Link
          to={templateId ? appRoutes.lyricsRemix(templateId) : appRoutes.lyricsHome}
          className="button ghost"
        >
          <ChevronLeft size={14} /> Back to remix
        </Link>
        <h1>
          <History size={18} /> Render jobs
        </h1>
        <span />
      </header>

      {error ? <div className="status-pill bad">{error}</div> : null}
      {loading ? (
        <div className="lyrics-loading">Loading jobs…</div>
      ) : batches.length === 0 ? (
        <div className="empty-state">No generation batches yet for this template.</div>
      ) : (
        <div className="batch-list">
          {batches.map((b) => {
            const c = counts[b.id] ?? { total: 0, ready: 0, scheduled: 0, posted: 0 };
            const tone =
              b.status === "complete"
                ? "good"
                : b.status === "failed"
                  ? "bad"
                  : b.paused_at
                    ? "muted"
                    : "warn";
            return (
              <article key={b.id} className="batch-row">
                <span className={`dot ${tone}`} />
                <div style={{ flex: 1 }}>
                  <strong>
                    {b.id.slice(0, 8)} · {b.source_mode}
                  </strong>
                  <span>
                    {b.status}
                    {b.paused_at ? " · paused" : ""} · qty {b.quantity} · cadence{" "}
                    {b.cadence_minutes}m
                  </span>
                  <small>created {new Date(b.created_at).toLocaleString()}</small>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong>
                    {c.ready + c.scheduled + c.posted}/{c.total || b.quantity}
                  </strong>
                  <small>
                    {c.ready} ready · {c.scheduled} scheduled · {c.posted} posted
                  </small>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
