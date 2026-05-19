import { useEffect, useState } from "react";
import { CalendarClock, Loader2, X } from "lucide-react";
import { bulkScheduleLibraryItems } from "@/lib/library/api";
import { displayError } from "@/lib/errors";
import {
  buildDefaultManualSlotValues,
  buildManualSlotsRule,
  localDateFromInputValue,
  toLocalInputValue,
} from "@/lib/calendar/posts";

type Mode = "cadence" | "daily_windows" | "manual_slots";

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
  const [jitterMinutes, setJitterMinutes] = useState(0);
  const [manualSlots, setManualSlots] = useState(() =>
    buildDefaultManualSlotValues(
      libraryItemIds.length,
      toLocalInputValue(new Date(Date.now() + 30 * 60_000)),
      240,
    ),
  );
  const [maxPerDay, setMaxPerDay] = useState(4);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("11:00");
  const [secondWindowStart, setSecondWindowStart] = useState("17:00");
  const [secondWindowEnd, setSecondWindowEnd] = useState("19:00");
  const [captionTemplate, setCaptionTemplate] = useState("{hookText} — sound on");
  const [hashtags, setHashtags] = useState("#fyp #music");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setManualSlots((current) =>
      current.length === libraryItemIds.length
        ? current
        : buildDefaultManualSlotValues(libraryItemIds.length, startAt, everyMinutes),
    );
  }, [everyMinutes, libraryItemIds.length, startAt]);

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
    if (nextMode === "manual_slots") {
      setManualSlots(buildDefaultManualSlotValues(libraryItemIds.length, startAt, everyMinutes));
    }
  }

  function setManualSlot(index: number, value: string) {
    setManualSlots((current) =>
      current.map((slot, slotIndex) => (slotIndex === index ? value : slot)),
    );
  }

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
              jitterMinutes,
            }
          : mode === "daily_windows"
            ? {
                type: "daily_windows",
                startDate: localDateFromInputValue(startAt),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                maxPerDay,
                jitterMinutes,
                windows: [
                  { start: windowStart, end: windowEnd },
                  { start: secondWindowStart, end: secondWindowEnd },
                ],
              }
            : buildManualSlotsRule(manualSlots.slice(0, libraryItemIds.length));
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
              onClick={() => selectMode(nextMode)}
            >
              {nextMode.replace("_", " ")}
            </button>
          ))}
        </div>

        {mode !== "manual_slots" ? (
          <div className="split">
            <label>
              Start
              <input
                type="datetime-local"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
              />
            </label>
            {mode === "cadence" ? (
              <label>
                Every min
                <input
                  type="number"
                  min={5}
                  value={everyMinutes}
                  onChange={(event) => setEveryMinutes(Number(event.target.value))}
                />
              </label>
            ) : null}
            <label>
              Jitter min
              <input
                type="number"
                min={0}
                max={240}
                value={jitterMinutes}
                onChange={(event) => setJitterMinutes(Number(event.target.value))}
              />
            </label>
          </div>
        ) : null}

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

        {mode === "manual_slots" ? (
          <div className="stack" aria-label="Manual schedule slots">
            {libraryItemIds.map((itemId, index) => (
              <label key={itemId}>
                Clip {index + 1}
                <input
                  type="datetime-local"
                  value={manualSlots[index] ?? ""}
                  onChange={(event) => setManualSlot(index, event.target.value)}
                />
              </label>
            ))}
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
