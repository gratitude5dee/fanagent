import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Library, Loader2, RefreshCcw } from "lucide-react";
import BulkScheduleDialog from "@/components/calendar/BulkScheduleDialog";
import LibraryGrid from "@/components/library/LibraryGrid";
import SegmentReplaceDialog from "@/components/library/SegmentReplaceDialog";
import SingleScheduleDialog from "@/components/library/SingleScheduleDialog";
import {
  getLibraryDetail,
  markLibraryItemUnfit,
  regenerateGenerationItems,
  type LibraryDetail as LibraryDetailData,
} from "@/lib/library/api";
import { displayError } from "@/lib/errors";
import type { LibraryItem } from "@/lib/library/types";

type Props = {
  audioClipId: string;
};

const POLL_MS = 5000;

function anyPending(data: LibraryDetailData | null): boolean {
  if (!data) return true;
  return data.items.some((item) => item.status === "not_ready");
}

export default function GeneratedLibraryPreview({ audioClipId }: Props) {
  const [data, setData] = useState<LibraryDetailData | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<{
    item: LibraryItem;
    segmentIndex: number;
  } | null>(null);
  const [bulkScheduleTargetIds, setBulkScheduleTargetIds] = useState<string[]>([]);
  const [singleScheduleTarget, setSingleScheduleTarget] = useState<LibraryItem | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(
    async (showBusy = true) => {
      if (showBusy) setBusy(true);
      try {
        const next = await getLibraryDetail(audioClipId);
        if (!cancelledRef.current) setData(next);
      } catch (error) {
        if (!cancelledRef.current) setMessage(displayError(error));
      } finally {
        if (showBusy && !cancelledRef.current) setBusy(false);
      }
    },
    [audioClipId],
  );

  // Reset & initial load when the clip changes.
  useEffect(() => {
    cancelledRef.current = false;
    setData(null);
    setSelectedIds(new Set());
    setMessage(null);
    refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [audioClipId, refresh]);

  // Poll while any item is still rendering.
  useEffect(() => {
    if (!data) return;
    if (!anyPending(data)) return;
    const t = setTimeout(() => refresh(false), POLL_MS);
    return () => clearTimeout(t);
  }, [data, refresh]);

  function toggleItem(itemId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function selectMany(itemIds: string[]) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of itemIds) next.add(id);
      return next;
    });
  }

  async function regenerate(generationItemIds: string[]) {
    if (generationItemIds.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await regenerateGenerationItems(generationItemIds);
      setSelectedIds(new Set());
      await refresh(false);
      setMessage(
        `Regenerated ${generationItemIds.length} item${generationItemIds.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  function regenerateOne(item: LibraryItem) {
    if (!item.generation_item_id) return;
    regenerate([item.generation_item_id]);
  }

  async function markUnfit(item: LibraryItem) {
    setBusy(true);
    setMessage(null);
    try {
      await markLibraryItemUnfit(item.id);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      await refresh(false);
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  const title = data?.clip.file_name || "Generated library";
  const pending = anyPending(data);

  return (
    <section className="panel">
      <div className="panel-title" style={{ alignItems: "center" }}>
        <Library size={16} />
        <h3 style={{ flex: 1 }}>5. Generated library preview</h3>
        <Link className="button ghost" to={`/library/${audioClipId}`}>
          <ExternalLink size={14} /> Open full library
        </Link>
        <button
          type="button"
          className="button ghost"
          disabled={busy}
          onClick={() => refresh()}
        >
          <RefreshCcw className={busy ? "spin" : undefined} size={14} /> Refresh
        </button>
      </div>

      <div className="stack">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>{title}</strong>
          {data ? (
            <span className="muted">
              {data.items.length} clip{data.items.length === 1 ? "" : "s"} ·{" "}
              {data.clip.duration_sec}s source
            </span>
          ) : null}
          {pending ? (
            <span className="status-pill">
              <Loader2 className="spin" size={12} /> rendering…
            </span>
          ) : null}
        </div>

        {message ? <div className="banner">{message}</div> : null}

        {!data ? (
          <div className="empty-state">
            <Loader2 className="spin" size={16} /> Loading generated clips…
          </div>
        ) : data.items.length === 0 ? (
          <div className="empty-state">No library items were generated for this clip.</div>
        ) : (
          <LibraryGrid
            items={data.items}
            selectedIds={selectedIds}
            busy={busy}
            onToggle={toggleItem}
            onSelectMany={selectMany}
            onClearSelection={() => setSelectedIds(new Set())}
            onBulkSchedule={(ids) => ids.length && setBulkScheduleTargetIds(ids)}
            onBulkRegenerate={regenerate}
            onRegenerate={regenerateOne}
            onMarkUnfit={markUnfit}
            onReplaceSegment={(item, segmentIndex) => setReplaceTarget({ item, segmentIndex })}
            onSchedule={setSingleScheduleTarget}
          />
        )}
      </div>

      <SegmentReplaceDialog
        audioClipId={audioClipId}
        accountId={data?.clip.account_id ?? ""}
        target={replaceTarget}
        onClose={() => setReplaceTarget(null)}
        onReplaced={() => {
          setReplaceTarget(null);
          refresh(false);
        }}
      />

      {bulkScheduleTargetIds.length > 0 ? (
        <BulkScheduleDialog
          libraryItemIds={bulkScheduleTargetIds}
          onClose={() => setBulkScheduleTargetIds([])}
          onScheduled={() => {
            setBulkScheduleTargetIds([]);
            setSelectedIds(new Set());
            refresh(false);
          }}
        />
      ) : null}

      {singleScheduleTarget ? (
        <SingleScheduleDialog
          item={singleScheduleTarget}
          onClose={() => setSingleScheduleTarget(null)}
          onScheduled={() => {
            setSingleScheduleTarget(null);
            refresh(false);
          }}
        />
      ) : null}
    </section>
  );
}
