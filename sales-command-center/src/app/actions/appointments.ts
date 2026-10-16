"use server";

import { revalidatePath } from "next/cache";
import type { AppointmentKind, AppointmentStatus } from "@prisma/client";
import { actorOrThrow } from "@/server/auth";
import { toResult, invalid, type ActionResult } from "@/server/errors";
import { createAppointment, moveAppointment, setAppointmentStatus, updateAppointmentDetails } from "@/server/services/appointments";
import { cancelRescheduleRequest, requestReschedule, resolveReschedule } from "@/server/services/reschedules";
import { getSettings } from "@/server/settings";
import { bool, id, int, str, strOrNull, zonedDate } from "@/server/form";

async function times(fd: FormData, prefix = "") {
  const tz = (await getSettings()).timezone;
  const start = zonedDate(fd, `${prefix}date`, `${prefix}time`, tz, "10:00");
  if (!start) throw invalid("Choose a date and time.");
  const minutes = int(fd, `${prefix}minutes`) ?? 45;
  if (minutes < 5 || minutes > 720) throw invalid("Length must be between 5 minutes and 12 hours.");
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
}

const ok = (message: string, redirect?: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message, redirect };
};

export async function createAppointmentAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const { start, end } = await times(fd);
    const appt = await createAppointment(actor, {
      leadId: id(fd, "leadId"),
      repId: strOrNull(fd, "repId", 40),
      kind: (str(fd, "kind") || "APPOINTMENT") as AppointmentKind,
      startAt: start,
      endAt: end,
      title: strOrNull(fd, "title", 200),
      location: strOrNull(fd, "location", 300),
      notes: strOrNull(fd, "notes", 5000),
      clientKey: strOrNull(fd, "clientKey", 80),
      allowOverlap: bool(fd, "allowOverlap"),
    });
    return ok("Appointment booked", `/appointments/${appt.id}?msg=Appointment+booked`);
  } catch (e) {
    return toResult(e);
  }
}

export async function moveAppointmentAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const { start, end } = await times(fd);
    await moveAppointment(actor, id(fd), start, end, strOrNull(fd, "reason", 500), { allowOverlap: bool(fd, "allowOverlap"), expectedVersion: int(fd, "version") });
    return ok("Appointment rescheduled — the original time is kept in the history.");
  } catch (e) {
    return toResult(e);
  }
}

export async function appointmentStatusAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const status = str(fd, "status") as AppointmentStatus;
    const apptId = id(fd);
    await setAppointmentStatus(actor, apptId, status, strOrNull(fd, "reason", 500));
    const m = status === "CANCELED" ? "Appointment canceled — it stays in the history." : "Appointment updated";
    return ok(m, `/appointments/${apptId}?msg=${encodeURIComponent(m)}`);
  } catch (e) {
    return toResult(e);
  }
}

export async function appointmentDetailsAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await updateAppointmentDetails(actor, id(fd), { title: strOrNull(fd, "title", 200), location: strOrNull(fd, "location", 300), notes: strOrNull(fd, "notes", 5000), kind: (str(fd, "kind") || "APPOINTMENT") as AppointmentKind });
    return ok("Details saved");
  } catch (e) {
    return toResult(e);
  }
}

export async function requestRescheduleAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const { start, end } = await times(fd);
    const apptId = id(fd);
    await requestReschedule(actor, { appointmentId: apptId, requestedStart: start, requestedEnd: end, reason: str(fd, "reason", 1000) ?? "" });
    return ok("Request sent", `/appointments/${apptId}?msg=${encodeURIComponent("Reschedule request sent — the appointment stays at its current time until the coordinator approves.")}`);
  } catch (e) {
    return toResult(e);
  }
}

export async function resolveRescheduleAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const decision = str(fd, "decision") === "decline" ? "decline" : "approve";
    let finalStart: Date | null = null;
    let finalEnd: Date | null = null;
    if (decision === "approve" && bool(fd, "editTime")) {
      const t = await times(fd);
      finalStart = t.start;
      finalEnd = t.end;
    }
    await resolveReschedule(actor, id(fd), decision, { notes: strOrNull(fd, "notes", 1000), finalStart, finalEnd, allowOverlap: bool(fd, "allowOverlap") });
    return ok(decision === "approve" ? "Approved — the appointment and calendar are updated." : "Declined — the rep has been notified.");
  } catch (e) {
    return toResult(e);
  }
}

export async function cancelRescheduleAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await cancelRescheduleRequest(actor, id(fd));
    return ok("Request withdrawn");
  } catch (e) {
    return toResult(e);
  }
}
