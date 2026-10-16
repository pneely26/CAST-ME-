import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import { assertCan, assertLeadAccess, assertOwnOrCoordinator, isCoordinator, type Actor } from "../policy";
import { conflict, invalid, notFound } from "../errors";
import { moveAppointmentInTx } from "./appointments";
import { notify, notifyCoordinators } from "./notifications";
import { canResolve, validateTimes } from "@/lib/domain/appointments";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/labels";
import { fmtDateTime } from "@/lib/time";
import { getSettings } from "../settings";

const requestSchema = z.object({
  appointmentId: z.string().min(10),
  requestedStart: z.date(),
  requestedEnd: z.date(),
  reason: z.string().trim().min(3, "Give a reason for the change").max(1000),
});

/** A rep (or coordinator) asks to move an appointment. The original stays booked until approved. */
export async function requestReschedule(actor: Actor, raw: z.input<typeof requestSchema>) {
  const d = requestSchema.parse(raw);
  const err = validateTimes(d.requestedStart, d.requestedEnd);
  if (err) throw invalid(err);
  return prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id: d.appointmentId }, include: { lead: true } });
    if (!appt) throw notFound("Appointment");
    assertLeadAccess(actor, appt.lead);
    assertOwnOrCoordinator(actor, appt.repId, "You can only request changes to your own appointments.");
    if (!ACTIVE_APPOINTMENT_STATUSES.includes(appt.status)) throw invalid("Only scheduled or confirmed appointments can be rescheduled.");
    const pending = await tx.rescheduleRequest.findFirst({ where: { appointmentId: appt.id, status: "PENDING" } });
    if (pending) throw conflict("There's already a pending reschedule request for this appointment. Cancel it first or wait for a decision.");
    const tz = (await getSettings(tx)).timezone;
    const req = await tx.rescheduleRequest.create({
      data: { appointmentId: appt.id, leadId: appt.leadId, originalStart: appt.startAt, originalEnd: appt.endAt, requestedStart: d.requestedStart, requestedEnd: d.requestedEnd, reason: d.reason, requestedById: actor.id },
    });
    await audit(tx, actor, "reschedule.requested", { type: "RescheduleRequest", id: req.id, leadId: appt.leadId }, `Reschedule requested: ${fmtDateTime(appt.startAt, tz)} → ${fmtDateTime(d.requestedStart, tz)} — ${d.reason}`);
    await notifyCoordinators(tx, { type: "RESCHEDULE_REQUESTED", title: `Reschedule request: ${appt.lead.businessName}`, body: `${actor.name}: ${fmtDateTime(appt.startAt, tz)} → ${fmtDateTime(d.requestedStart, tz)}. ${d.reason}`, link: `/reschedules#${req.id}`, dedupeKey: `resched-req:${req.id}` }, actor.id);
    return req;
  });
}

/**
 * Coordinator decision. Approve (optionally with an edited final time) moves the SAME appointment —
 * no duplicate is created — and keeps the original time in the change history.
 */
export async function resolveReschedule(actor: Actor, id: string, decision: "approve" | "decline", opts: { notes?: string | null; finalStart?: Date | null; finalEnd?: Date | null; allowOverlap?: boolean } = {}) {
  assertCan(actor, "reschedule.resolve", "Only the coordinator can approve or decline reschedule requests.");
  return prisma.$transaction(async (tx) => {
    const req = await tx.rescheduleRequest.findUnique({ where: { id }, include: { lead: true, appointment: true } });
    if (!req) throw notFound("Reschedule request");
    if (!canResolve(req.status, decision)) throw conflict(`This request is already ${req.status.toLowerCase()}.`);
    const tz = (await getSettings(tx)).timezone;
    if (decision === "decline") {
      if (!opts.notes) throw invalid("Add a note explaining why the request was declined.");
      await tx.rescheduleRequest.update({ where: { id }, data: { status: "DECLINED", resolutionNotes: opts.notes, resolvedById: actor.id, resolvedAt: new Date() } });
      await audit(tx, actor, "reschedule.declined", { type: "RescheduleRequest", id, leadId: req.leadId }, `Reschedule declined — appointment stays at ${fmtDateTime(req.appointment.startAt, tz)}. ${opts.notes}`);
      await notify(tx, req.requestedById, { type: "RESCHEDULE_DECLINED", title: `Reschedule declined: ${req.lead.businessName}`, body: opts.notes, link: `/appointments/${req.appointmentId}`, dedupeKey: `resched-dec:${id}` });
      return;
    }
    const finalStart = opts.finalStart ?? req.requestedStart;
    const finalEnd = opts.finalEnd ?? (opts.finalStart ? new Date(opts.finalStart.getTime() + (req.requestedEnd.getTime() - req.requestedStart.getTime())) : req.requestedEnd);
    if (req.appointment.startAt.getTime() !== req.originalStart.getTime()) {
      // appointment moved since the request was made — still allowed, history records both
    }
    await moveAppointmentInTx(tx, actor, req.appointmentId, finalStart, finalEnd, `Reschedule approved: ${req.reason}`, { allowOverlap: opts.allowOverlap, rescheduleRequestId: req.id });
    await tx.rescheduleRequest.update({ where: { id }, data: { status: "APPROVED", resolutionNotes: opts.notes ?? null, resolvedById: actor.id, resolvedAt: new Date(), finalStart, finalEnd } });
    await audit(tx, actor, "reschedule.approved", { type: "RescheduleRequest", id, leadId: req.leadId }, `Reschedule approved: now ${fmtDateTime(finalStart, tz)}${finalStart.getTime() !== req.requestedStart.getTime() ? " (time adjusted by coordinator)" : ""}`);
    await notify(tx, req.requestedById, { type: "RESCHEDULE_APPROVED", title: `Reschedule approved: ${req.lead.businessName}`, body: `New time: ${fmtDateTime(finalStart, tz)}${opts.notes ? ` — ${opts.notes}` : ""}`, link: `/appointments/${req.appointmentId}`, dedupeKey: `resched-ok:${id}` });
  }, { timeout: 20_000 });
}

export async function cancelRescheduleRequest(actor: Actor, id: string) {
  return prisma.$transaction(async (tx) => {
    const req = await tx.rescheduleRequest.findUnique({ where: { id } });
    if (!req) throw notFound("Reschedule request");
    if (!isCoordinator(actor) && req.requestedById !== actor.id) throw invalid("You can only withdraw your own requests.");
    if (!canResolve(req.status, "cancel")) throw conflict(`This request is already ${req.status.toLowerCase()}.`);
    await tx.rescheduleRequest.update({ where: { id }, data: { status: "CANCELED", resolvedById: actor.id, resolvedAt: new Date(), resolutionNotes: "Withdrawn" } });
    await audit(tx, actor, "reschedule.canceled", { type: "RescheduleRequest", id, leadId: req.leadId }, "Reschedule request withdrawn");
  });
}
