import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, Home, Library, RefreshCcw } from "lucide-react";
import LibraryGrid from "@/components/library/LibraryGrid";
import SegmentReplaceDialog from "@/components/library/SegmentReplaceDialog";
import {
  getLibraryDetail,
  regenerateGenerationItems,
  type LibraryDetail as LibraryDetailData,
} from "@/lib/library/api";
import { displayError } from "@/lib/errors";
import type { LibraryItem } from "@/lib/library/types";

function titleFor(data: LibraryDetailData | null): string {
  if (!data) return "Library";
  return data.clip.file_name || `Audio clip ${data.clip.id.slice(0, 8)}`;
}

export default function LibraryDetail() {
  const { audioClipId } = useParams();
  const [data, setData] = useState<LibraryDetailData | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [replaceTarget, setReplaceTarget] = useState<{
    item: LibraryItem;
    segmentIndex: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!audioClipId) return;
    setBusy(true);
    setMessage(null);
    try {
      setData(await getLibraryDetail(audioClipId));
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }, [audioClipId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!audioClipId) return <Navigate to="/library" replace />;

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
      for (const itemId of itemIds) next.add(itemId);
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
      await refresh();
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

  return (
    <main className="app-shell library-shell">
      <header className="topbar">
        <div>
          <h1>{titleFor(data)}</h1>
          <p>
            {data
              ? `${data.items.length} library items · ${data.clip.duration_sec}s source clip`
              : "Loading library"}
          </p>
        </div>
        <div className="topbar-actions">
          <Link className="button ghost" to="/library">
            <ArrowLeft size={14} /> Library
          </Link>
          <Link className="button ghost" to="/">
            <Home size={14} /> Home
          </Link>
          <button className="button ghost" type="button" disabled={busy} onClick={refresh}>
            <RefreshCcw className={busy ? "spin" : undefined} size={14} /> Refresh
          </button>
        </div>
      </header>

      {message ? <div className="banner">{message}</div> : null}

      {!data ? (
        <section className="panel">
          <div className="empty-state">
            <Library size={18} /> Loading library items…
          </div>
        </section>
      ) : (
        <LibraryGrid
          items={data.items}
          selectedIds={selectedIds}
          busy={busy}
          onToggle={toggleItem}
          onSelectMany={selectMany}
          onClearSelection={() => setSelectedIds(new Set())}
          onBulkRegenerate={regenerate}
          onRegenerate={regenerateOne}
          onReplaceSegment={(item, segmentIndex) => setReplaceTarget({ item, segmentIndex })}
        />
      )}

      <SegmentReplaceDialog
        audioClipId={audioClipId}
        accountId={data?.clip.account_id ?? ""}
        target={replaceTarget}
        onClose={() => setReplaceTarget(null)}
        onReplaced={() => {
          setReplaceTarget(null);
          refresh();
        }}
      />
    </main>
  );
}
