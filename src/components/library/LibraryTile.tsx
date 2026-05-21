import { useState } from "react";
import {
  CalendarClock,
  Ban,
  CheckSquare2,
  Copy,
  Download,
  RefreshCcw,
  Replace,
  Square,
  Video,
} from "lucide-react";
import type { LibraryItem, LibrarySegment } from "@/lib/library/types";
import {
  canRegenerateLibraryItem,
  canScheduleLibraryItem,
  libraryAttributionLines,
  libraryCaptionText,
  libraryDownloadFileName,
  libraryDownloadUrl,
  libraryQualityMarkers,
  libraryStatusTone,
} from "@/lib/library/ui";

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
  onMarkUnfit,
  onReplaceSegment,
  onSchedule,
}: {
  item: LibraryItem;
  selected: boolean;
  onToggle: (itemId: string) => void;
  onRegenerate: (item: LibraryItem) => void;
  onMarkUnfit: (item: LibraryItem) => void;
  onReplaceSegment: (item: LibraryItem, segmentIndex: number) => void;
  onSchedule: (item: LibraryItem) => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const mediaUrl = item.media?.public_url ?? null;
  const previewUrl = item.thumbnail_url ?? mediaUrl;
  const downloadUrl = libraryDownloadUrl(item);
  const tone = libraryStatusTone(item.status);
  const schedulable = canScheduleLibraryItem(item);
  const attributions = libraryAttributionLines(item);
  const qualityMarkers = libraryQualityMarkers(item);
  const regeneratable = canRegenerateLibraryItem(item);

  async function copyCaption() {
    const text = libraryCaptionText(item);
    if (!text || !navigator.clipboard) {
      setCopyState("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

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
        {item.status === "failed" ? (
          <div className="banner bad" style={{ marginTop: 4 }}>
            Render failed
            {typeof item.metadata?.error === "string" && item.metadata.error
              ? `: ${String(item.metadata.error).slice(0, 220)}`
              : ". Click Regenerate to retry."}
          </div>
        ) : null}
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
        {qualityMarkers.length > 0 ? (
          <div className="library-quality-markers">
            {qualityMarkers.map((marker) => (
              <span key={marker.key} className={`status-pill ${marker.tone}`}>
                {marker.label}
              </span>
            ))}
            {typeof item.metadata?.lyric_font === "string" && item.metadata.lyric_font ? (
              <span className="status-pill idle">Font: {String(item.metadata.lyric_font)}</span>
            ) : null}
          </div>
        ) : typeof item.metadata?.lyric_font === "string" && item.metadata.lyric_font ? (
          <div className="library-quality-markers">
            <span className="status-pill idle">Font: {String(item.metadata.lyric_font)}</span>
          </div>
        ) : null}
        {attributions.length > 0 ? (
          <div className="library-attributions">
            <span>Attribution</span>
            {attributions.slice(0, 2).map((attribution) => (
              <small key={attribution}>{attribution}</small>
            ))}
            {attributions.length > 2 ? <small>+{attributions.length - 2} more</small> : null}
          </div>
        ) : null}
        <div className="library-tile__actions">
          <button
            type="button"
            className="button primary"
            disabled={!schedulable}
            onClick={() => onSchedule(item)}
          >
            <CalendarClock size={14} /> Schedule
          </button>
          <button
            type="button"
            className="button ghost"
            disabled={!regeneratable}
            onClick={() => onRegenerate(item)}
            title={
              regeneratable ? "Regenerate this clip" : "Posted and archived clips cannot regenerate"
            }
          >
            <RefreshCcw size={14} /> Regenerate
          </button>
          <button
            type="button"
            className="button ghost"
            disabled={item.status === "posted" || item.status === "blocked"}
            onClick={() => onMarkUnfit(item)}
          >
            <Ban size={14} /> Mark unfit
          </button>
          {downloadUrl ? (
            <a
              className="button ghost"
              href={downloadUrl}
              download={libraryDownloadFileName(item)}
              rel="noreferrer"
            >
              <Download size={14} /> Download
            </a>
          ) : (
            <button type="button" className="button ghost" disabled>
              <Download size={14} /> Download
            </button>
          )}
          <button type="button" className="button ghost" onClick={copyCaption}>
            <Copy size={14} />
            {copyState === "copied"
              ? "Copied"
              : copyState === "failed"
                ? "Copy failed"
                : "Copy caption"}
          </button>
        </div>
      </div>
    </article>
  );
}
