import { useState } from "react";
import { CalendarClock, Loader2, X } from "lucide-react";
import { displayError } from "@/lib/errors";
import { scheduleLibraryItems } from "@/lib/library/api";
import type { LibraryItem } from "@/lib/library/types";
import { defaultSingleScheduleInput, parseSingleScheduleInput } from "@/lib/library/ui";

function hashtagsValue(item: LibraryItem): string {
  return item.default_hashtags.join(" ");
}

function splitHashtags(value: string): string[] {
  return value
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export default function SingleScheduleDialog({
  item,
  onClose,
  onScheduled,
}: {
  item: LibraryItem;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [scheduledAt, setScheduledAt] = useState(() => defaultSingleScheduleInput());
  const [caption, setCaption] = useState(item.default_caption ?? "");
  const [hashtags, setHashtags] = useState(() => hashtagsValue(item));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      await scheduleLibraryItems([
        {
          libraryItemId: item.id,
          scheduledAt: parseSingleScheduleInput(scheduledAt),
          caption: caption.trim() || undefined,
          hashtags: splitHashtags(hashtags),
          tiktokOptions: {
            privacyLevel: "SELF_ONLY",
            disableDuet: true,
            disableStitch: true,
            disableComment: false,
          },
        },
      ]);
      onScheduled();
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="library-dialog-backdrop" role="presentation">
      <section
        className="library-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Schedule clip ${item.library_index + 1}`}
      >
        <div className="library-dialog__header">
          <div>
            <h2>Schedule clip {item.library_index + 1}</h2>
            <span>{item.duration_sec}s ready library item</span>
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

        {message ? <div className="banner bad">{message}</div> : null}

        <label>
          Schedule time
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        </label>

        <label>
          Caption
          <textarea value={caption} rows={3} onChange={(event) => setCaption(event.target.value)} />
        </label>

        <label>
          Hashtags
          <input value={hashtags} onChange={(event) => setHashtags(event.target.value)} />
        </label>

        <div className="action-row">
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="spin" size={14} /> : <CalendarClock size={14} />}
            Schedule
          </button>
        </div>
      </section>
    </div>
  );
}
