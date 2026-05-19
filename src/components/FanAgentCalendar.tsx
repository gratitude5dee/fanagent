import { useEffect, type RefObject } from "react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable, type DropArg } from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { EventDropArg, EventInput } from "@fullcalendar/core";
import type { CalendarView } from "@/lib/calendar/posts";

type FanAgentCalendarProps = {
  events: EventInput[];
  view: Exclude<CalendarView, "agenda">;
  onEventDrop: (arg: EventDropArg) => void;
  onEventClick: (postId: string) => void;
  externalLibraryContainerRef?: RefObject<HTMLElement | null>;
  onExternalLibraryDrop?: (libraryItemId: string, scheduledAt: Date) => void;
};

const fullCalendarView: Record<Exclude<CalendarView, "agenda">, string> = {
  month: "dayGridMonth",
  week: "timeGridWeek",
  day: "timeGridDay",
};

export default function FanAgentCalendar({
  events,
  view,
  onEventDrop,
  onEventClick,
  externalLibraryContainerRef,
  onExternalLibraryDrop,
}: FanAgentCalendarProps) {
  useEffect(() => {
    const container = externalLibraryContainerRef?.current;
    if (!container || !onExternalLibraryDrop) return undefined;
    const draggable = new Draggable(container, {
      itemSelector: ".calendar-library-card",
      eventData: (eventEl) => ({
        title: eventEl.getAttribute("data-title") ?? "Library item",
      }),
    });
    return () => draggable.destroy();
  }, [externalLibraryContainerRef, onExternalLibraryDrop]);

  function handleExternalDrop(arg: DropArg) {
    const libraryItemId = arg.draggedEl.getAttribute("data-library-item-id");
    if (!libraryItemId || !onExternalLibraryDrop) return;
    onExternalLibraryDrop(libraryItemId, arg.date);
  }

  return (
    <FullCalendar
      key={view}
      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
      initialView={fullCalendarView[view]}
      height="auto"
      editable
      selectable
      nowIndicator
      events={events}
      eventDrop={onEventDrop}
      eventClick={(arg) => onEventClick(arg.event.id)}
      droppable={!!onExternalLibraryDrop}
      drop={handleExternalDrop}
      headerToolbar={{
        left: "prev,next today",
        center: "title",
        right: "",
      }}
    />
  );
}
