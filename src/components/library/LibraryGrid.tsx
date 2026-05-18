import { useMemo, useState } from "react";
import { RefreshCcw, Search, X } from "lucide-react";
import LibraryTile from "./LibraryTile";
import type { LibraryItem, LibraryStatus } from "@/lib/library/types";
import { filterLibraryItems, selectedRegeneratableIds } from "@/lib/library/ui";

const FILTERS: Array<{ key: LibraryStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "not_ready", label: "Building" },
  { key: "scheduled", label: "Scheduled" },
  { key: "failed", label: "Failed" },
  { key: "blocked", label: "Blocked" },
  { key: "posted", label: "Posted" },
];

export default function LibraryGrid({
  items,
  selectedIds,
  busy,
  onToggle,
  onSelectMany,
  onClearSelection,
  onBulkRegenerate,
  onRegenerate,
  onReplaceSegment,
}: {
  items: LibraryItem[];
  selectedIds: Set<string>;
  busy: boolean;
  onToggle: (itemId: string) => void;
  onSelectMany: (itemIds: string[]) => void;
  onClearSelection: () => void;
  onBulkRegenerate: (generationItemIds: string[]) => void;
  onRegenerate: (item: LibraryItem) => void;
  onReplaceSegment: (item: LibraryItem, segmentIndex: number) => void;
}) {
  const [status, setStatus] = useState<LibraryStatus>("all");
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => filterLibraryItems(items, { status, query }),
    [items, query, status],
  );
  const selectedGenerationIds = useMemo(
    () => selectedRegeneratableIds(items, selectedIds),
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
            disabled={busy || selectedGenerationIds.length === 0}
            onClick={() => onBulkRegenerate(selectedGenerationIds)}
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
              onReplaceSegment={onReplaceSegment}
            />
          ))}
        </div>
      )}
    </section>
  );
}
