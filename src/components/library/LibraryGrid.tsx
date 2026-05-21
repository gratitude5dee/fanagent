import { useMemo, useState } from "react";
import { CalendarClock, RefreshCcw, Search, X } from "lucide-react";
import LibraryTile from "./LibraryTile";
import type { LibraryItem, RegenerateTarget } from "@/lib/library/types";
import {
  filterLibraryItems,
  type LibrarySortMode,
  type LibraryStatusFilter,
  selectedRegeneratableTargets,
  selectedSchedulableIds,
} from "@/lib/library/ui";

const FILTERS: Array<{ key: LibraryStatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unscheduled", label: "Unscheduled" },
  { key: "scheduled", label: "Scheduled" },
  { key: "posted", label: "Posted" },
  { key: "blocked", label: "Blocked" },
  { key: "failed", label: "Failed" },
];

export default function LibraryGrid({
  items,
  selectedIds,
  busy,
  onToggle,
  onSelectMany,
  onClearSelection,
  onBulkSchedule,
  onBulkRegenerate,
  onRegenerate,
  onMarkUnfit,
  onReplaceSegment,
  onSchedule,
}: {
  items: LibraryItem[];
  selectedIds: Set<string>;
  busy: boolean;
  onToggle: (itemId: string) => void;
  onSelectMany: (itemIds: string[]) => void;
  onClearSelection: () => void;
  onBulkSchedule: (libraryItemIds: string[]) => void;
  onBulkRegenerate: (targets: RegenerateTarget[]) => void;
  onRegenerate: (item: LibraryItem) => void;
  onMarkUnfit: (item: LibraryItem) => void;
  onReplaceSegment: (item: LibraryItem, segmentIndex: number) => void;
  onSchedule: (item: LibraryItem) => void;
}) {
  const [status, setStatus] = useState<LibraryStatusFilter>("all");
  const [sort, setSort] = useState<LibrarySortMode>("distinct");
  const [randomSeed, setRandomSeed] = useState(() => String(Date.now()));
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => filterLibraryItems(items, { status, query, sort, randomSeed }),
    [items, query, randomSeed, sort, status],
  );
  const selectedRegenerateTargets = useMemo(
    () => selectedRegeneratableTargets(items, selectedIds),
    [items, selectedIds],
  );
  const selectedLibraryIds = useMemo(
    () => selectedSchedulableIds(items, selectedIds),
    [items, selectedIds],
  );

  return (
    <section className="library-grid-panel">
      <div className="library-toolbar">
        <div className="library-filters" aria-label="Library filters">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`button ${status === filter.key ? "primary" : "ghost"}`}
              onClick={() => setStatus(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <label className="library-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search captions, providers, prompts"
          />
        </label>
        <label>
          Sort
          <select
            value={sort}
            onChange={(event) => {
              const nextSort = event.target.value as LibrarySortMode;
              setSort(nextSort);
              if (nextSort === "random") setRandomSeed(String(Date.now()));
            }}
          >
            <option value="distinct">Distinctness</option>
            <option value="created">Created</option>
            <option value="next_scheduled">Next scheduled</option>
            <option value="random">Random</option>
          </select>
        </label>
      </div>

      <div className="library-bulkbar">
        <span>
          {filtered.length} visible · {selectedIds.size} selected
        </span>
        <div className="action-row">
          <button
            type="button"
            className="button ghost"
            onClick={() => onSelectMany(filtered.map((item) => item.id))}
          >
            Select visible
          </button>
          <button type="button" className="button ghost" onClick={onClearSelection}>
            <X size={14} /> Clear
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || selectedLibraryIds.length === 0}
            onClick={() => onBulkSchedule(selectedLibraryIds)}
          >
            <CalendarClock size={14} /> Schedule selected
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || selectedRegenerateTargets.length === 0}
            onClick={() => onBulkRegenerate(selectedRegenerateTargets)}
          >
            <RefreshCcw size={14} /> Regenerate selected
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No library items match this view.</div>
      ) : (
        <div className="library-grid">
          {filtered.map((item) => (
            <LibraryTile
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              onToggle={onToggle}
              onRegenerate={onRegenerate}
              onMarkUnfit={onMarkUnfit}
              onReplaceSegment={onReplaceSegment}
              onSchedule={onSchedule}
            />
          ))}
        </div>
      )}
    </section>
  );
}
