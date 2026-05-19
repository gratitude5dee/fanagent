import { useEffect, useMemo, useState } from "react";
import { Loader2, Replace, Search, X } from "lucide-react";
import { replaceLibrarySegment, searchReplacementCandidates } from "@/lib/library/api";
import { displayError } from "@/lib/errors";
import type { LibraryItem, LibrarySegment, SourceCandidate } from "@/lib/library/types";
import { librarySegmentTargetDurationSeconds } from "@/lib/library/ui";

const SOURCE_OPTIONS = [
  { key: "stock", label: "Stock" },
  { key: "library", label: "Library" },
  { key: "seedance", label: "Seedance" },
  { key: "gmi_seedance", label: "GMI" },
  { key: "sports_edit", label: "Sports" },
  { key: "streamer_clip", label: "Streamer" },
];

function defaultSource(segment: LibrarySegment | null): string {
  const source = segment?.sourceType || segment?.source_type || segment?.source || "stock";
  return SOURCE_OPTIONS.some((option) => option.key === source) ? source : "stock";
}

function candidateLabel(candidate: SourceCandidate): string {
  const duration = Number(candidate.duration_seconds ?? 0).toFixed(1);
  return `${candidate.provider} · ${duration}s · ${candidate.license}`;
}

export default function SegmentReplaceDialog({
  audioClipId,
  accountId,
  target,
  onClose,
  onReplaced,
}: {
  audioClipId: string;
  accountId: string;
  target: { item: LibraryItem; segmentIndex: number } | null;
  onClose: () => void;
  onReplaced: () => void;
}) {
  const segment = target?.item.segments[target.segmentIndex] ?? null;
  const [sourceType, setSourceType] = useState(defaultSource(segment));
  const [query, setQuery] = useState(segment?.query || segment?.prompt || "");
  const [candidates, setCandidates] = useState<SourceCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSourceType(defaultSource(segment));
    setQuery(segment?.query || segment?.prompt || "");
    setCandidates([]);
    setMessage(null);
  }, [segment, target?.item.id, target?.segmentIndex]);

  const title = useMemo(() => {
    if (!target) return "Replace segment";
    return `Replace clip ${target.item.library_index + 1}, segment ${target.segmentIndex + 1}`;
  }, [target]);

  if (!target) return null;
  const activeTarget = target;

  async function search() {
    setBusy(true);
    setMessage(null);
    try {
      const next = await searchReplacementCandidates({
        libraryItemId: activeTarget.item.id,
        audioClipId,
        accountId,
        segmentIndex: activeTarget.segmentIndex,
        sourceType,
        query,
        targetDurationSec: librarySegmentTargetDurationSeconds(
          activeTarget.item,
          activeTarget.segmentIndex,
        ),
      });
      setCandidates(next);
      setMessage(next.length ? null : "No candidates returned for this query.");
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  async function replace(candidateId: string) {
    setBusy(true);
    setMessage(null);
    try {
      await replaceLibrarySegment({
        libraryItemId: activeTarget.item.id,
        segmentIndex: activeTarget.segmentIndex,
        candidateId,
      });
      onReplaced();
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="library-dialog-backdrop" role="presentation">
      <section className="library-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="library-dialog__header">
          <div>
            <h2>{title}</h2>
            <span>{segment?.provider || segment?.source || "current source"} replacement</span>
          </div>
          <button
            type="button"
            className="button ghost"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        {message ? <div className="banner">{message}</div> : null}

        <div className="split">
          <label>
            Source
            <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Query
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>

        <div className="action-row">
          <button type="button" className="button primary" disabled={busy} onClick={search}>
            {busy ? <Loader2 className="spin" size={14} /> : <Search size={14} />} Search
          </button>
        </div>

        <div className="library-candidate-list">
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className="library-candidate"
              disabled={busy}
              onClick={() => replace(candidate.id)}
            >
              <Replace size={14} />
              <div>
                <strong>{candidateLabel(candidate)}</strong>
                <span>{candidate.external_id || candidate.origin_url}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
