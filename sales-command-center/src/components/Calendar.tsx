"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import type { EventDropArg, DateSelectArg, EventClickArg, EventApi } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";

interface Props {
  timeZone: string;
  role: "COORDINATOR" | "REP";
  repId: string | null; // null = all reps
  initialDate?: string;
  initialView?: string;
}

/**
 * Calendar with day / week / month / agenda views (week is the default).
 * Coordinator: drag or resize to move an appointment (conflicts ask for confirmation).
 * Rep: dragging opens a reschedule request instead — nothing moves until approved.
 */
export function Calendar({ timeZone, role, repId, initialDate, initialView = "timeGridWeek" }: Props) {
  const router = useRouter();
  const ref = useRef<FullCalendar>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [showCanceled, setShowCanceled] = useState(false);

  async function handleMove(event: EventApi, revert: () => void) {
    const id = event.extendedProps.id as string;
    const start = event.start?.toISOString();
    const end = (event.end ?? new Date(event.start!.getTime() + 45 * 60_000)).toISOString();
    if (role === "REP") {
      const reason = window.prompt("Reschedule request — why does this appointment need to move?");
      revert(); // stays at the original time until the coordinator approves
      if (!reason) return;
      const r = await fetch("/api/reschedules/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, start, end, reason }) }).then((x) => x.json());
      setMessage(r.ok ? { tone: "good", text: "Reschedule request sent to the coordinator." } : { tone: "bad", text: r.error });
      router.refresh();
      return;
    }
    let r = await fetch("/api/appointments/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, start, end }) }).then((x) => x.json());
    if (!r.ok && r.code === "CONFLICT" && r.details?.conflicts && window.confirm(`${r.error}\n\nBook anyway?`)) {
      r = await fetch("/api/appointments/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, start, end, allowOverlap: true }) }).then((x) => x.json());
    }
    if (!r.ok) {
      revert();
      setMessage({ tone: "bad", text: r.error });
    } else {
      setMessage({ tone: "good", text: "Appointment moved. The original time is kept in its history." });
      ref.current?.getApi().refetchEvents();
      router.refresh();
    }
  }

  return (
    <div className="card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-gray-500" /> Territory plan (all-day row)</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-blue-600" /> Scheduled</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-[#3451b2]" /> Confirmed</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2.5 w-2.5 rounded-sm border-l-2 border-dashed border-amber-600 bg-orange-50" /> Follow-up (↻)</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Completed</span>
        <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={showCanceled} onChange={(e) => { setShowCanceled(e.target.checked); setTimeout(() => ref.current?.getApi().refetchEvents(), 0); }} /> Show canceled</label>
      </div>
      {message && (
        <div role={message.tone === "bad" ? "alert" : "status"} className={`mb-2 rounded-md border px-3 py-2 text-sm ${message.tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"}`}>
          {message.text} <button className="ml-2 underline" onClick={() => setMessage(null)}>Dismiss</button>
        </div>
      )}
      <FullCalendar
        ref={ref}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
        timeZone={timeZone}
        initialView={initialView}
        initialDate={initialDate}
        headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridDay,timeGridWeek,dayGridMonth,listWeek" }}
        buttonText={{ today: "Today", day: "Day", week: "Week", month: "Month", list: "Agenda" }}
        firstDay={1}
        height="auto"
        slotMinTime="07:00:00"
        slotMaxTime="20:00:00"
        nowIndicator
        allDayText="Plan"
        editable
        eventDurationEditable
        selectable
        selectMirror
        dayMaxEvents={4}
        events={{ url: `/api/calendar?rep=${repId ?? "all"}${showCanceled ? "&canceled=1" : ""}` }}
        eventDrop={(arg: EventDropArg) => handleMove(arg.event, arg.revert)}
        eventResize={(arg: EventResizeDoneArg) => handleMove(arg.event, arg.revert)}
        eventClick={(arg: EventClickArg) => {
          arg.jsEvent.preventDefault();
          const p = arg.event.extendedProps;
          if (p.type === "appointment") router.push(`/appointments/${p.id}`);
          else if (p.type === "plan") router.push(`/schedule/day/${p.date}${role === "COORDINATOR" ? `?rep=${p.repId}` : ""}`);
          else if (p.leadId) router.push(`/leads/${p.leadId}`);
        }}
        select={(arg: DateSelectArg) => {
          if (arg.allDay) router.push(`/schedule/day/${arg.startStr.slice(0, 10)}${repId && role === "COORDINATOR" ? `?rep=${repId}` : ""}`);
          else router.push(`/appointments/new?start=${encodeURIComponent(arg.startStr)}&end=${encodeURIComponent(arg.endStr)}${repId ? `&rep=${repId}` : ""}`);
        }}
      />
      <p className="mt-2 text-xs text-muted">
        {role === "COORDINATOR" ? "Drag an appointment to move it, or select a time slot to book one. Click a plan to edit that day." : "Drag an appointment to request a new time (the coordinator approves). Select a time slot to book an appointment."}
      </p>
    </div>
  );
}
