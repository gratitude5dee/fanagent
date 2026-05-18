import { CheckSquare2, RefreshCcw, Replace, Square, Video } from "lucide-react";
import type { LibraryItem, LibrarySegment } from "@/lib/library/types";
import { libraryStatusTone } from "@/lib/library/ui";

function segmentLabel(segment: LibrarySegment, index: number): string {
  const provider = segment.provider || segment.source || "source";
  const query = segment.query || segment.prompt || segment.externalId || `segment ${index + 1}`;
  return `${provider}: ${query}`;
}

export default function LibraryTile({
  item,
  selected,
  onToggle,
  onRegenerate,
  onReplaceSegment,
}: {
  item: LibraryItem;
  selected: boolean;
  onToggle: (itemId: string) => void;
  onRegenerate: (item: LibraryItem) => void;
  onReplaceSegment: (item: LibraryItem, segmentIndex: number) => void;
}) {
  const mediaUrl = item.media?.public_url ?? null;
  const previewUrl = item.thumbnail_url ?? mediaUrl;
  const tone = libraryStatusTone(item.status);

  return (
    <article className="library-tile">
      <div className="library-tile__media">
        {mediaUrl ? (
          <video src={mediaUrl} poster={item.thumbnail_url ?? undefined} muted preload="metadata" />
        ) : previewUrl ? (
          <img alt="" src={previewUrl} />
        ) : (
          <div className="library-tile__placeholder">
            <Video size={22} />
          </div>
        )}
        <button
          type="button"
          className="library-select"
          aria-label={selected ? "Deselect library item" : "Select library item"}
          onClick={() => onToggle(item.id)}
        >
          {selected ? <CheckSquare2 size={18} /> : <Square size={18} />}
        </button>
      </div>
      <div className="library-tile__body">
        <div className="library-tile__headline">
          <div>
            <strong>Clip {item.library_index + 1}</strong>
            <span>{item.duration_sec}s vertical edit</span>
          </div>
          <span className={`status-pill ${tone}`}>{item.status.replace("_", " ")}</span>
        </div>
        <p>{item.default_caption || "Caption pending"}</p>
        <div className="library-segments">
          {item.segments.slice(0, 4).map((segment, index) => (
            <button
              key={`${item.id}-${index}`}
              type="button"
              className="library-segment-chip"
              onClick={() => onReplaceSegment(item, index)}
              title="Replace segment"
            >
              <Replace size={12} />
              <span>{segmentLabel(segment, index)}</span>
            </button>
          ))}
          {item.segments.length === 0 ? (
            <span className="library-muted">Segments pending</span>
          ) : null}
        </div>
        <div className="library-tile__actions">
          <button
            type="button"
            className="button ghost"
            disabled={!item.generation_item_id}
            onClick={() => onRegenerate(item)}
          >
            <RefreshCcw size={14} /> Regenerate
          </button>
        </div>
      </div>
    </article>
  );
}
