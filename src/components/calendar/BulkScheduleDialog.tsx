import { useState } from "react";
import { CalendarClock, Loader2, X } from "lucide-react";
import { bulkScheduleLibraryItems } from "@/lib/library/api";
import { displayError } from "@/lib/errors";

type Mode = "cadence" | "daily_windows" | "manual_slots";

function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function BulkScheduleDialog({
  libraryItemIds,
  onClose,
  onScheduled,
}: {
  libraryItemIds: string[];
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [mode, setMode] = useState<Mode>("cadence");
  const [startAt, setStartAt] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 30 * 60_000)),
  );
  const [everyMinutes, setEveryMinutes] = useState(240);
  const [maxPerDay, setMaxPerDay] = useState(4);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("11:00");
  const [secondWindowStart, setSecondWindowStart] = useState("17:00");
  const [secondWindowEnd, setSecondWindowEnd] = useState("19:00");
  const [captionTemplate, setCaptionTemplate] = useState("{hookText} — sound on");
  const [hashtags, setHashtags] = useState("#fyp #music");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const startDate = new Date(startAt);
      const rule =
        mode === "cadence"
          ? {
              type: "cadence",
              startAt: startDate.toISOString(),
              everyMinutes,
            }
          : mode === "daily_windows"
            ? {
                type: "daily_windows",
                startDate: startDate.toISOString().slice(0, 10),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                maxPerDay,
                windows: [
                  { start: windowStart, end: windowEnd },
                  { start: secondWindowStart, end: secondWindowEnd },
                ],
              }
            : {
                type: "manual_slots",
                slots: libraryItemIds.map((_id, index) => ({
                  scheduledAt: new Date(
                    startDate.getTime() + index * everyMinutes * 60_000,
                  ).toISOString(),
                })),
              };
      await bulkScheduleLibraryItems({
        libraryItemIds,
        rule,
        captionTemplate,
        hashtags: hashtags
          .split(/\s+/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        tiktokOptions: {
          privacyLevel: "SELF_ONLY",
          disableDuet: true,
          disableStitch: true,
          disableComment: false,
          isAigc: true,
        },
      });
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
        aria-label="Bulk schedule"
      >
        <div className="library-dialog__header">
          <div>
            <h2>Schedule selected</h2>
            <span>{libraryItemIds.length} ready library items</span>
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

        <div className="library-filters">
          {(["cadence", "daily_windows", "manual_slots"] as Mode[]).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              className={`button ${mode === nextMode ? "primary" : "ghost"}`}
              onClick={() => setMode(nextMode)}
            >
              {nextMode.replace("_", " ")}
            </button>
          ))}
        </div>

        <div className="split">
          <label>
            Start
            <input
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </label>
          <label>
            Every min
            <input
              type="number"
              min={5}
              value={everyMinutes}
              onChange={(event) => setEveryMinutes(Number(event.target.value))}
            />
          </label>
        </div>

        {mode === "daily_windows" ? (
          <div className="split">
            <label>
              AM window
              <input value={windowStart} onChange={(event) => setWindowStart(event.target.value)} />
              <input value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} />
            </label>
            <label>
              PM window
              <input
                value={secondWindowStart}
                onChange={(event) => setSecondWindowStart(event.target.value)}
              />
              <input
                value={secondWindowEnd}
                onChange={(event) => setSecondWindowEnd(event.target.value)}
              />
            </label>
            <label>
              Max per day
              <input
                type="number"
                min={1}
                value={maxPerDay}
                onChange={(event) => setMaxPerDay(Number(event.target.value))}
              />
            </label>
          </div>
        ) : null}

        <label>
          Caption template
          <input
            value={captionTemplate}
            onChange={(event) => setCaptionTemplate(event.target.value)}
          />
        </label>
        <label>
          Hashtags
          <input value={hashtags} onChange={(event) => setHashtags(event.target.value)} />
        </label>

        <div className="action-row">
          <button
            type="button"
            className="button primary"
            disabled={busy || libraryItemIds.length === 0}
            onClick={submit}
          >
            {busy ? <Loader2 className="spin" size={14} /> : <CalendarClock size={14} />}
            Schedule
          </button>
        </div>
      </section>
    </div>
  );
}
