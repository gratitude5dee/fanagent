import { useMemo } from "react";
import type { EventDropArg, EventInput } from "@fullcalendar/core";
import {
  CALENDAR_STATUS_FILTERS,
  CALENDAR_VIEWS,
  calendarEventForPost,
  filterCalendarPosts,
  publishStatusLabel,
  statusTone,
  type CalendarAccount,
  type CalendarFilters,
  type CalendarLibraryPreview,
  type CalendarPost,
  type CalendarStatusFilter,
  type CalendarView,
} from "@/lib/calendar/posts";
import FanAgentCalendar from "@/components/FanAgentCalendar";

export interface StudioCalendarPanelProps {
  posts: CalendarPost[];
  libraryPreviews: CalendarLibraryPreview[];
  accounts: CalendarAccount[];
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  filters: CalendarFilters;
  onFiltersChange: (filters: CalendarFilters) => void;
  onEventDrop: (arg: EventDropArg) => void;
  onEventClick: (postId: string) => void;
  externalLibraryContainerRef: React.RefObject<HTMLDivElement | null>;
  onExternalLibraryDrop: (libraryItemId: string, scheduledAt: Date) => void;
  audioClipIds: string[];
}

function viewLabel(view: CalendarView): string {
  if (view === "month") return "Month";
  if (view === "week") return "Week";
  if (view === "day") return "Day";
  return "Agenda";
}

export default function StudioCalendarPanel({
  posts,
  libraryPreviews,
  accounts,
  view,
  onViewChange,
  filters,
  onFiltersChange,
  onEventDrop,
  onEventClick,
  externalLibraryContainerRef,
  onExternalLibraryDrop,
  audioClipIds,
}: StudioCalendarPanelProps) {
  const filteredPosts = useMemo(
    () => filterCalendarPosts(posts, libraryPreviews, filters),
    [filters, libraryPreviews, posts],
  );
  const events = useMemo<EventInput[]>(
    () => filteredPosts.map((post) => calendarEventForPost(post)),
    [filteredPosts],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );

  return (
    <>
      <section className="panel calendar-controls" aria-label="Calendar controls">
        <div className="calendar-view-toggle" aria-label="Calendar view">
          {CALENDAR_VIEWS.map((calendarView) => (
            <button
              key={calendarView}
              type="button"
              className={`button ${view === calendarView ? "primary" : "ghost"}`}
              onClick={() => onViewChange(calendarView)}
            >
              {viewLabel(calendarView)}
            </button>
          ))}
        </div>
        <div className="calendar-filter-row">
          <label>
            Account
            <select
              value={filters.accountId}
              onChange={(event) => onFiltersChange({ ...filters, accountId: event.target.value })}
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.handle ?? account.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Audio clip
            <select
              value={filters.audioClipId}
              onChange={(event) => onFiltersChange({ ...filters, audioClipId: event.target.value })}
            >
              <option value="">All audio clips</option>
              {audioClipIds.map((audioClipId) => (
                <option key={audioClipId} value={audioClipId}>
                  {audioClipId.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={filters.status}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  status: event.target.value as CalendarStatusFilter,
                })
              }
            >
              {CALENDAR_STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {status === "all" ? "All statuses" : status.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="calendar-legend" aria-label="Calendar color legend">
          <span>
            <i className="event-idle" /> Pending
          </span>
          <span>
            <i className="event-warn" /> Posting
          </span>
          <span>
            <i className="event-good" /> Posted
          </span>
          <span>
            <i className="event-bad" /> Failed
          </span>
          <span>
            <i className="event-muted" /> Skipped
          </span>
          <span>
            <i className="event-blocked" /> Blocked
          </span>
          <strong>{filteredPosts.length} visible</strong>
        </div>
      </section>

      <section className="panel calendar-panel">
        {view === "agenda" ? (
          <div className="calendar-agenda">
            {filteredPosts.length === 0 ? (
              <div className="empty-state">No scheduled posts match these filters.</div>
            ) : (
              filteredPosts.map((post) => {
                const account = accountById.get(post.account_id);
                return (
                  <button
                    key={post.id}
                    type="button"
                    className="calendar-agenda-row"
                    onClick={() => onEventClick(post.id)}
                  >
                    <span className={`dot ${statusTone(post)}`} />
                    <div>
                      <strong>{new Date(post.scheduled_at).toLocaleString()}</strong>
                      <span>{post.caption || "Scheduled post"}</span>
                      <small>
                        {account?.handle ?? post.account_id.slice(0, 8)} - {post.status} -{" "}
                        {publishStatusLabel(post.publish_status)}
                      </small>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <FanAgentCalendar
            view={view}
            events={events}
            onEventDrop={onEventDrop}
            onEventClick={onEventClick}
            externalLibraryContainerRef={externalLibraryContainerRef}
            onExternalLibraryDrop={onExternalLibraryDrop}
          />
        )}
      </section>
    </>
  );
}
