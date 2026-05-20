import { CalendarDays } from "lucide-react";
import type { LibraryItem } from "@/lib/library/types";

export interface StudioReadyLibraryPanelProps {
  libraryItems: LibraryItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onBulkScheduleOpen: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function titleForItem(item: LibraryItem): string {
  return item.default_caption || `Library clip ${item.library_index + 1}`;
}

export default function StudioReadyLibraryPanel({
  libraryItems,
  selectedIds,
  onToggle,
  onBulkScheduleOpen,
  containerRef,
}: StudioReadyLibraryPanelProps) {
  return (
    <aside className="panel calendar-library-panel" ref={containerRef}>
      <div className="panel-title">
        <CalendarDays size={16} />
        <h2>Ready library</h2>
      </div>
      <div className="library-bulkbar">
        <span>{selectedIds.size} selected</span>
        <button
          type="button"
          className="button primary"
          disabled={selectedIds.size === 0}
          onClick={onBulkScheduleOpen}
        >
          Schedule selected
        </button>
      </div>
      <div className="calendar-library-list">
        {libraryItems.length === 0 ? (
          <div className="empty-state">No ready library items yet.</div>
        ) : (
          libraryItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`calendar-library-card ${selectedIds.has(item.id) ? "selected" : ""}`}
              data-library-item-id={item.id}
              data-title={titleForItem(item)}
              draggable
              onClick={() => onToggle(item.id)}
            >
              <span>{item.duration_sec}s</span>
              <strong>{titleForItem(item)}</strong>
              <small>Drag to schedule - click to select</small>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
