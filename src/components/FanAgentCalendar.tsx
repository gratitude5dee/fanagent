import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { EventDropArg, EventInput } from "@fullcalendar/core";

type FanAgentCalendarProps = {
  events: EventInput[];
  onEventDrop: (arg: EventDropArg) => void;
  onEventClick: (postId: string) => void;
};

export default function FanAgentCalendar({
  events,
  onEventDrop,
  onEventClick,
}: FanAgentCalendarProps) {
  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
      initialView="timeGridWeek"
      height="auto"
      editable
      selectable
      nowIndicator
      events={events}
      eventDrop={onEventDrop}
      eventClick={(arg) => onEventClick(arg.event.id)}
      headerToolbar={{
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,timeGridDay",
      }}
    />
  );
}
