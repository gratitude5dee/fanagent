import { useEffect, useMemo, useRef, useState } from "react";
import type { EventDropArg, EventInput } from "@fullcalendar/core";
import { Link } from "react-router-dom";
import { CalendarDays, Home, Images, RefreshCcw } from "lucide-react";
import BulkScheduleDialog from "@/components/calendar/BulkScheduleDialog";
import FanAgentCalendar from "@/components/FanAgentCalendar";
import { listReadyLibraryItems, scheduleLibraryItems } from "@/lib/library/api";
import { displayError } from "@/lib/errors";
import type { LibraryItem } from "@/lib/library/types";
import { supabase } from "@/integrations/supabase/client";

type CalendarPost = {
  id: string;
  caption: string;
  scheduled_at: string;
  status: string;
  publish_status: string | null;
  video_url: string | null;
  library_item_id?: string | null;
};

type FunctionEnvelope<T> = {
  success: boolean;
  code?: string;
  message?: string;
  data: T | null;
  error?: string | null;
};

function unwrapFunctionData<T>(value: unknown): T {
  if (typeof value !== "object" || value === null || !("success" in value)) return value as T;
  const envelope = value as FunctionEnvelope<T>;
  if (envelope.success) return envelope.data as T;
  throw new Error(envelope.error || envelope.message || envelope.code || "Function failed");
}

function eventClass(post: CalendarPost): string {
  if (post.publish_status?.startsWith("blocked_")) return "event-blocked";
  if (post.status === "posted" || post.publish_status === "publish_complete") return "event-good";
  if (post.status === "failed" || post.publish_status === "failed") return "event-bad";
  if (post.status === "posting" || post.publish_status === "processing") return "event-warn";
  if (post.status === "skipped") return "event-muted";
  return "event-idle";
}

function titleForItem(item: LibraryItem): string {
  return item.default_caption || `Library clip ${item.library_index + 1}`;
}

export default function CalendarPage() {
  const libraryPanelRef = useRef<HTMLDivElement>(null);
  const [posts, setPosts] = useState<CalendarPost[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const [postRows, readyItems] = await Promise.all([
        supabase
          .from("posts")
          .select("id,caption,scheduled_at,status,publish_status,video_url,library_item_id")
          .order("scheduled_at", { ascending: true })
          .limit(250),
        listReadyLibraryItems(80),
      ]);
      if (postRows.error) throw postRows.error;
      setPosts((postRows.data ?? []) as CalendarPost[]);
      setLibraryItems(readyItems);
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const events = useMemo<EventInput[]>(
    () =>
      posts.map((post) => ({
        id: post.id,
        title: post.caption || "Scheduled post",
        start: post.scheduled_at,
        classNames: [eventClass(post)],
      })),
    [posts],
  );

  async function updatePostSchedule(arg: EventDropArg) {
    const scheduledAt = arg.event.start?.toISOString();
    if (!scheduledAt) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("update-post-schedule", {
        body: { postId: arg.event.id, scheduledAt },
      });
      if (error) {
        if (data) unwrapFunctionData(data);
        throw new Error(error.message);
      }
      unwrapFunctionData(data);
      await refresh();
    } catch (error) {
      arg.revert();
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  async function scheduleDrop(libraryItemId: string, scheduledAt: Date) {
    setBusy(true);
    setMessage(null);
    try {
      await scheduleLibraryItems([{ libraryItemId, scheduledAt: scheduledAt.toISOString() }]);
      setSelectedLibraryIds(new Set());
      await refresh();
      setMessage("Library item scheduled.");
    } catch (error) {
      setMessage(displayError(error));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function toggleLibraryItem(itemId: string) {
    setSelectedLibraryIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  return (
    <main className="app-shell calendar-page">
      <header className="topbar">
        <div>
          <h1>Calendar</h1>
          <p>Drag ready library items onto open slots or bulk schedule a set.</p>
        </div>
        <div className="topbar-actions">
          <Link className="button ghost" to="/">
            <Home size={14} /> Home
          </Link>
          <Link className="button ghost" to="/library">
            <Images size={14} /> Library
          </Link>
          <button className="button ghost" type="button" disabled={busy} onClick={refresh}>
            <RefreshCcw className={busy ? "spin" : undefined} size={14} /> Refresh
          </button>
        </div>
      </header>

      {message ? <div className="banner">{message}</div> : null}

      <div className="calendar-workspace">
        <aside className="panel calendar-library-panel" ref={libraryPanelRef}>
          <div className="panel-title">
            <CalendarDays size={16} />
            <h2>Ready library</h2>
          </div>
          <div className="library-bulkbar">
            <span>{selectedLibraryIds.size} selected</span>
            <button
              type="button"
              className="button primary"
              disabled={selectedLibraryIds.size === 0}
              onClick={() => setDialogOpen(true)}
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
                  className={`calendar-library-card ${selectedLibraryIds.has(item.id) ? "selected" : ""}`}
                  data-library-item-id={item.id}
                  data-title={titleForItem(item)}
                  draggable
                  onClick={() => toggleLibraryItem(item.id)}
                >
                  <span>{item.duration_sec}s</span>
                  <strong>{titleForItem(item)}</strong>
                  <small>Drag to schedule · click to select</small>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="panel calendar-panel">
          <FanAgentCalendar
            events={events}
            onEventDrop={updatePostSchedule}
            onEventClick={(postId) => setMessage(`Selected post ${postId.slice(0, 8)}.`)}
            externalLibraryContainerRef={libraryPanelRef}
            onExternalLibraryDrop={scheduleDrop}
          />
        </section>
      </div>

      {dialogOpen ? (
        <BulkScheduleDialog
          libraryItemIds={Array.from(selectedLibraryIds)}
          onClose={() => setDialogOpen(false)}
          onScheduled={() => {
            setDialogOpen(false);
            setSelectedLibraryIds(new Set());
            refresh();
          }}
        />
      ) : null}
    </main>
  );
}
