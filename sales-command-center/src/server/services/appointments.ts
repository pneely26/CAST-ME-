import { z } from "zod";
import type { AppointmentKind, AppointmentStatus } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { audit } from "../audit";
import { assertCan, assertLeadAccess, assertOwnOrCoordinator, isCoordinator, type Actor } from "../policy";
import { conflict, invalid, notFound, forbidden } from "../errors";
import { refreshLeadRollups } from "./rollups";
import { notify, notifyCoordinators } from "./notifications";
import { findConflicts, findDuplicate, validateTimes } from "@/lib/domain/appointments";
import { blocksOutreach, advanceStatus } from "@/lib/domain/rollups";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/labels";
import { fmtDateTime } from "@/lib/time";
import { getSettings } from "../settings";

export const appointmentSchema = z.object({
  leadId: z.string().min(10),
  repId: z.string().min(10).optional().nullable(),
  kind: z.enum(["APPOINTMENT", "FOLLOW_UP_VISIT"]).default("APPOINTMENT"),
  startAt: z.date(),
  endAt: z.date(),
  title: z.string().trim().max(200).optional().nullable(),
  location: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  clientKey: z.string().max(80).optional().nullable(),
  /** user confirmed they want to book despite an overlapping appointment */
  allowOverlap: z.boolean().default(false),
});

export async function createAppointmentInTx(tx: Tx, actor: Actor, raw: z.input<typeof appointmentSchema>) {
  const d = appointmentSchema.parse(raw);
  const err = validateTimes(d.startAt, d.endAt);
  if (err) throw invalid(err);
  if (d.clientKey) {
    const existing = await tx.appointment.findUnique({ where: { clientKey: d.clientKey } });
    if (existing) return existing; // same form submitted twice
  }
  const lead = await tx.lead.findUnique({ where: { id: d.leadId } });
  if (!lead || lead.archivedAt) throw notFound("Lead");
  assertLeadAccess(actor, lead);
  if (blocksOutreach(lead.status)) throw invalid("This lead is marked Do Not Contact — appointments can't be booked.");
  const repId = isCoordinator(actor) ? (d.repId ?? lead.assignedRepId) : actor.id;
  if (!repId) throw invalid("Assign this lead to a rep (or choose a rep) before booking an appointment.");
  const rep = await tx.user.findUnique({ where: { id: repId } });
  if (!rep || rep.role !== "REP" || !rep.active) throw invalid("Appointments must be with an active sales rep.");

  const settings = await getSettings(tx);
  const windowMs = settings.duplicateAppointmentWindowMinutes * 60_000;
  const nearby = await tx.appointment.findMany({
    where: { status: { in: ACTIVE_APPOINTMENT_STATUSES }, OR: [{ repId }, { leadId: d.leadId }], startAt: { gte: new Date(d.startAt.getTime() - 24 * 3_600_000 - windowMs), lte: new Date(d.endAt.getTime() + 24 * 3_600_000 + windowMs) } },
  });
  const dup = findDuplicate({ leadId: d.leadId, startAt: d.startAt }, nearby, settings.duplicateAppointmentWindowMinutes);
  if (dup) throw conflict(`${lead.businessName} already has an active appointment at ${fmtDateTime(dup.startAt, settings.timezone)}. Reschedule that one instead of booking a second.`, { duplicateId: dup.id });
  const overlaps = findConflicts({ repId, startAt: d.startAt, endAt: d.endAt }, nearby);
  if (overlaps.length && !d.allowOverlap) {
    throw conflict(`Time conflict: ${rep.name} already has ${overlaps.length} appointment(s) overlapping this time (${overlaps.map((o) => fmtDateTime(o.startAt, settings.timezone)).join(", ")}). Tick “Book anyway” to keep both.`, { conflicts: overlaps.map((o) => o.id) });
  }

  const appt = await tx.appointment.create({
    data: { leadId: d.leadId, repId, kind: d.kind as AppointmentKind, startAt: d.startAt, endAt: d.endAt, title: d.title ?? null, location: d.location ?? ([lead.address, lead.city].filter(Boolean).join(", ") || null), notes: d.notes ?? null, createdById: actor.id, clientKey: d.clientKey ?? null },
  });
  await tx.appointmentChange.create({ data: { appointmentId: appt.id, action: "CREATED", toStart: appt.startAt, toEnd: appt.endAt, changedById: actor.id } });
  await audit(tx, actor, "appointment.created", { type: "Appointment", id: appt.id, leadId: lead.id }, `${d.kind === "FOLLOW_UP_VISIT" ? "Follow-up visit" : "Appointment"} scheduled for ${fmtDateTime(appt.startAt, settings.timezone)} with ${rep.name}${overlaps.length ? " (overlap confirmed)" : ""}`);
  const next = advanceStatus(lead.status, "APPOINTMENT_SCHEDULED");
  if (next !== lead.status) {
    await tx.lead.update({ where: { id: lead.id }, data: { status: next, version: { increment: 1 } } });
    await audit(tx, actor, "lead.status", { type: "Lead", id: lead.id, leadId: lead.id }, `Status → Appointment Scheduled (appointment booked)`, { from: lead.status, to: next });
  }
  if (repId !== actor.id) await notify(tx, repId, { type: "APPOINTMENT_UPCOMING", title: `New appointment: ${lead.businessName}`, body: fmtDateTime(appt.startAt, settings.timezone), link: `/appointments/${appt.id}`, dedupeKey: `appt-new:${appt.id}` });
  else if (!isCoordinator(actor)) await notifyCoordinators(tx, { type: "APPOINTMENT_UPCOMING", title: `${actor.name} booked ${lead.businessName}`, body: fmtDateTime(appt.startAt, settings.timezone), link: `/appointments/${appt.id}`, dedupeKey: `appt-new:${appt.id}` });
  await refreshLeadRollups(tx, lead.id);
  return appt;
}

export async function createAppointment(actor: Actor, raw: z.input<typeof appointmentSchema>) {
  return prisma.$transaction((tx) => createAppointmentInTx(tx, actor, raw));
}

/**
 * Move an appointment directly (coordinator only — reps request changes instead).
 * The appointment row stays the same scheduling event; the old time is kept in AppointmentChange.
 */
export async function moveAppointmentInTx(tx: Tx, actor: Actor, id: string, startAt: Date, endAt: Date, reason: string | null, opts: { allowOverlap?: boolean; rescheduleRequestId?: string; expectedVersion?: number } = {}) {
  if (!opts.rescheduleRequestId) assertCan(actor, "appointment.moveDirect", "Sales reps request schedule changes — the coordinator approves them.");
  const err = validateTimes(startAt, endAt);
  if (err) throw invalid(err);
  const appt = await tx.appointment.findUnique({ where: { id }, include: { lead: true, rep: true } });
  if (!appt) throw notFound("Appointment");
  if (!ACTIVE_APPOINTMENT_STATUSES.includes(appt.status)) throw invalid("Only scheduled or confirmed appointments can be moved.");
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== appt.version) throw conflict("This appointment was changed by someone else. Reload and try again.");
  const settings = await getSettings(tx);
  const nearby = await tx.appointment.findMany({ where: { id: { not: id }, status: { in: ACTIVE_APPOINTMENT_STATUSES }, OR: [{ repId: appt.repId }, { leadId: appt.leadId }], startAt: { gte: new Date(startAt.getTime() - 86_400_000), lte: new Date(endAt.getTime() + 86_400_000) } } });
  const dup = findDuplicate({ id, leadId: appt.leadId, startAt }, nearby, settings.duplicateAppointmentWindowMinutes);
  if (dup) throw conflict(`${appt.lead.businessName} already has another active appointment at ${fmtDateTime(dup.startAt, settings.timezone)}.`);
  const overlaps = findConflicts({ id, repId: appt.repId, startAt, endAt }, nearby);
  if (overlaps.length && !opts.allowOverlap) throw conflict(`Time conflict with ${overlaps.length} other appointment(s) for ${appt.rep.name}. Tick “Book anyway” to keep both.`, { conflicts: overlaps.map((o) => o.id) });
  const updated = await tx.appointment.updateMany({ where: { id, version: appt.version }, data: { startAt, endAt, version: { increment: 1 } } });
  if (!updated.count) throw conflict("This appointment was just changed by someone else. Reload and try again.");
  await tx.appointmentChange.create({ data: { appointmentId: id, action: "MOVED", fromStart: appt.startAt, fromEnd: appt.endAt, toStart: startAt, toEnd: endAt, reason, changedById: actor.id, rescheduleRequestId: opts.rescheduleRequestId ?? null } });
  await audit(tx, actor, "appointment.moved", { type: "Appointment", id, leadId: appt.leadId }, `Appointment rescheduled: ${fmtDateTime(appt.startAt, settings.timezone)} → ${fmtDateTime(startAt, settings.timezone)}${reason ? ` (${reason})` : ""}`);
  if (appt.repId !== actor.id) await notify(tx, appt.repId, { type: "APPOINTMENT_UPCOMING", title: `Appointment moved: ${appt.lead.businessName}`, body: `Now ${fmtDateTime(startAt, settings.timezone)} (was ${fmtDateTime(appt.startAt, settings.timezone)})`, link: `/appointments/${id}`, dedupeKey: `appt-moved:${id}:${startAt.toISOString()}` });
  await refreshLeadRollups(tx, appt.leadId);
}

export async function moveAppointment(actor: Actor, id: string, startAt: Date, endAt: Date, reason: string | null, opts: { allowOverlap?: boolean; expectedVersion?: number } = {}) {
  return prisma.$transaction(async (tx) => {
    // a direct move resolves any pending request for this appointment
    const pending = await tx.rescheduleRequest.findMany({ where: { appointmentId: id, status: "PENDING" } });
    await moveAppointmentInTx(tx, actor, id, startAt, endAt, reason, opts);
    for (const p of pending) {
      await tx.rescheduleRequest.update({ where: { id: p.id }, data: { status: "CANCELED", resolvedById: actor.id, resolvedAt: new Date(), resolutionNotes: "Appointment was moved directly by the coordinator." } });
    }
  });
}

/** Status changes: cancel (with reason), confirm, complete, no-show, restore. Records are never deleted. */
export async function setAppointmentStatus(actor: Actor, id: string, status: AppointmentStatus, reason: string | null) {
  return prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id }, include: { lead: true } });
    if (!appt) throw notFound("Appointment");
    assertLeadAccess(actor, appt.lead);
    assertOwnOrCoordinator(actor, appt.repId, "This appointment belongs to another rep.");
    if (status === "CANCELED") {
      if (!isCoordinator(actor)) throw forbidden("Sales reps can't cancel appointments directly — submit a reschedule request explaining the change, or ask the coordinator.");
      if (!reason) throw invalid("Give a reason for canceling.");
    }
    if (status === "SCHEDULED" && appt.status === "CANCELED") {
      assertCan(actor, "appointment.cancelAny");
      const settings = await getSettings(tx);
      const nearby = await tx.appointment.findMany({ where: { id: { not: id }, status: { in: ACTIVE_APPOINTMENT_STATUSES }, leadId: appt.leadId } });
      const dup = findDuplicate({ id, leadId: appt.leadId, startAt: appt.startAt }, nearby, settings.duplicateAppointmentWindowMinutes);
      if (dup) throw conflict("This lead already has another active appointment at that time.");
    }
    const action = status === "CANCELED" ? "CANCELED" : status === "COMPLETED" ? "COMPLETED" : status === "NO_SHOW" ? "NO_SHOW" : status === "SCHEDULED" && appt.status === "CANCELED" ? "RESTORED" : "EDITED";
    await tx.appointment.update({ where: { id }, data: { status, cancelReason: status === "CANCELED" ? reason : appt.cancelReason, canceledAt: status === "CANCELED" ? new Date() : status === "SCHEDULED" ? null : appt.canceledAt, version: { increment: 1 } } });
    await tx.appointmentChange.create({ data: { appointmentId: id, action, fromStart: appt.startAt, fromEnd: appt.endAt, reason, changedById: actor.id } });
    if (status === "CANCELED") {
      await tx.rescheduleRequest.updateMany({ where: { appointmentId: id, status: "PENDING" }, data: { status: "CANCELED", resolvedById: actor.id, resolvedAt: new Date(), resolutionNotes: "Appointment canceled." } });
      if (appt.repId !== actor.id) await notify(tx, appt.repId, { type: "APPOINTMENT_CANCELED", title: `Appointment canceled: ${appt.lead.businessName}`, body: reason ?? undefined, link: `/appointments/${id}`, dedupeKey: `appt-cancel:${id}:${Date.now()}` });
    }
    const labels: Record<string, string> = { CANCELED: "canceled", COMPLETED: "marked completed", NO_SHOW: "marked no-show", CONFIRMED: "confirmed", SCHEDULED: "restored" };
    await audit(tx, actor, `appointment.${action.toLowerCase()}`, { type: "Appointment", id, leadId: appt.leadId }, `Appointment ${labels[status] ?? status.toLowerCase()}${reason ? `: ${reason}` : ""}`);
    await refreshLeadRollups(tx, appt.leadId);
  });
}

export async function updateAppointmentDetails(actor: Actor, id: string, data: { title?: string | null; location?: string | null; notes?: string | null; kind?: AppointmentKind }) {
  return prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id }, include: { lead: true } });
    if (!appt) throw notFound("Appointment");
    assertLeadAccess(actor, appt.lead);
    assertOwnOrCoordinator(actor, appt.repId);
    await tx.appointment.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    await tx.appointmentChange.create({ data: { appointmentId: id, action: "EDITED", changedById: actor.id, reason: "Details updated" } });
    await audit(tx, actor, "appointment.edited", { type: "Appointment", id, leadId: appt.leadId }, "Appointment details updated");
  });
}
