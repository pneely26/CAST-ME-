import { z } from "zod";
import type { InterestLevel, LeadStatus, VisitOutcome, VisitType } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { assertLeadAccess, isCoordinator, type Actor } from "../policy";
import { invalid, notFound } from "../errors";
import { refreshLeadRollups } from "./rollups";
import { createFollowUpInTx } from "./followups";
import { createAppointmentInTx } from "./appointments";
import { changeLeadStatusInTx } from "./leads";
import { notifyCoordinators } from "./notifications";
import { INTEREST_LEVELS, LEAD_STATUSES, VISIT_OUTCOMES, VISIT_OUTCOME_LABEL, VISIT_TYPES, VISIT_TYPE_LABEL, IN_PERSON_TYPES } from "@/lib/labels";
import { suggestStatusAfterVisit } from "@/lib/domain/rollups";
import { dateKeyInTz, fmtDateTime } from "@/lib/time";
import { getSettings } from "../settings";
import type { StoredFile } from "../storage";

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const visitSchema = z
  .object({
    leadId: z.string().min(10),
    repId: z.string().optional().nullable(),
    visitAt: z.date(),
    type: z.enum(VISIT_TYPES as [VisitType, ...VisitType[]]),
    outcome: z.enum(VISIT_OUTCOMES as [VisitOutcome, ...VisitOutcome[]], { error: "Choose the visit outcome" }),
    contactEncountered: optText(150),
    feedback: optText(10000),
    objections: optText(5000),
    interestLevel: z.enum(INTEREST_LEVELS as [InterestLevel, ...InterestLevel[]]).optional().nullable(),
    followUpAction: optText(500),
    followUpDueAt: z.date().optional().nullable(),
    nextAppointmentStart: z.date().optional().nullable(),
    nextAppointmentEnd: z.date().optional().nullable(),
    appointmentId: z.string().optional().nullable(), // appointment this visit fulfills
    notes: optText(10000),
    newStatus: z.enum(LEAD_STATUSES as [LeadStatus, ...LeadStatus[]]).optional().nullable(),
    clientKey: z.string().max(80).optional().nullable(),
    allowOverlap: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.followUpAction && !v.followUpDueAt) ctx.addIssue({ code: "custom", path: ["followUpDueAt"], message: "Choose a due date for the follow-up" });
    if (v.followUpDueAt && !v.followUpAction) ctx.addIssue({ code: "custom", path: ["followUpAction"], message: "Describe the follow-up action" });
    if (v.visitAt.getTime() > Date.now() + 15 * 60_000) ctx.addIssue({ code: "custom", path: ["visitAt"], message: "Visit time can't be in the future — use an appointment for future visits" });
    if (v.nextAppointmentStart && v.nextAppointmentStart.getTime() < Date.now()) ctx.addIssue({ code: "custom", path: ["nextAppointmentStart"], message: "The next appointment must be in the future" });
  });
export type VisitInput = z.input<typeof visitSchema>;

/**
 * Record a completed visit. One transaction:
 *  1. permanent Visit row (older visits are never changed)
 *  2. follow-up task if requested
 *  3. next appointment if booked (duplicate/conflict rules apply)
 *  4. today's planned stop marked visited; fulfilled appointment marked completed
 *  5. lead status (suggested automatically, user may override) + rollups (last visit, feedback…)
 *  6. coordinator notified of new feedback
 */
export async function recordVisit(actor: Actor, raw: VisitInput, attachment?: StoredFile | null) {
  const d = visitSchema.parse(raw);
  if (d.clientKey) {
    const existing = await prisma.visit.findUnique({ where: { clientKey: d.clientKey } });
    if (existing) return existing;
  }
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: d.leadId } });
    if (!lead || lead.archivedAt) throw notFound("Lead");
    assertLeadAccess(actor, lead);
    const settings = await getSettings(tx);
    const tz = settings.timezone;
    let repId = actor.id;
    if (isCoordinator(actor)) {
      repId = d.repId ?? lead.assignedRepId ?? "";
      if (!repId) throw invalid("Choose which rep made this visit (the lead isn't assigned).");
    }
    const rep = await tx.user.findUnique({ where: { id: repId } });
    if (!rep || rep.role !== "REP") throw invalid("Visits are recorded for a sales rep.");

    const visit = await tx.visit.create({
      data: {
        leadId: lead.id,
        repId,
        visitAt: d.visitAt,
        type: d.type,
        outcome: d.outcome,
        contactEncountered: d.contactEncountered,
        feedback: d.feedback,
        objections: d.objections,
        interestLevel: d.interestLevel ?? null,
        followUpAction: d.followUpAction,
        followUpDueAt: d.followUpDueAt ?? null,
        notes: d.notes,
        appointmentId: d.appointmentId ?? null,
        clientKey: d.clientKey ?? null,
        attachmentPath: attachment?.path ?? null,
        attachmentName: attachment?.name ?? null,
        attachmentMime: attachment?.mime ?? null,
      },
    });
    await audit(tx, actor, "visit.recorded", { type: "Visit", id: visit.id, leadId: lead.id }, `${VISIT_TYPE_LABEL[d.type]} by ${rep.name}: ${VISIT_OUTCOME_LABEL[d.outcome]}${d.feedback ? ` — “${d.feedback.slice(0, 140)}${d.feedback.length > 140 ? "…" : ""}”` : ""}`);

    if (d.followUpAction && d.followUpDueAt) {
      await createFollowUpInTx(tx, actor, { leadId: lead.id, dueAt: d.followUpDueAt, action: d.followUpAction, assignedToId: repId, sourceVisitId: visit.id });
    }

    let bookedId: string | null = null;
    if (d.nextAppointmentStart) {
      const end = d.nextAppointmentEnd ?? new Date(d.nextAppointmentStart.getTime() + settings.defaultAppointmentMinutes * 60_000);
      const appt = await createAppointmentInTx(tx, actor, { leadId: lead.id, repId, startAt: d.nextAppointmentStart, endAt: end, kind: "APPOINTMENT", notes: `Booked during visit on ${fmtDateTime(d.visitAt, tz)}`, allowOverlap: d.allowOverlap, clientKey: d.clientKey ? `${d.clientKey}:appt` : null });
      bookedId = appt.id;
      await tx.visit.update({ where: { id: visit.id }, data: { nextAppointmentId: appt.id } });
    }

    if (d.appointmentId) {
      const appt = await tx.appointment.findUnique({ where: { id: d.appointmentId } });
      if (appt && appt.leadId === lead.id && (appt.status === "SCHEDULED" || appt.status === "CONFIRMED")) {
        await tx.appointment.update({ where: { id: appt.id }, data: { status: "COMPLETED", version: { increment: 1 } } });
        await tx.appointmentChange.create({ data: { appointmentId: appt.id, action: "COMPLETED", fromStart: appt.startAt, fromEnd: appt.endAt, changedById: actor.id, reason: "Visit recorded" } });
      }
    }

    if (IN_PERSON_TYPES.includes(d.type)) {
      const day = dateKeyInTz(d.visitAt, tz);
      const stop = await tx.dayPlanStop.findFirst({ where: { leadId: lead.id, status: "PLANNED", dayPlan: { repId, date: day } } });
      if (stop) await tx.dayPlanStop.update({ where: { id: stop.id }, data: { status: "VISITED", visitId: visit.id } });
    }

    const suggested = suggestStatusAfterVisit(lead.status, { type: d.type, outcome: d.outcome, hasFollowUp: Boolean(d.followUpAction), bookedAppointment: Boolean(bookedId) });
    const target = d.newStatus ?? suggested;
    if (target !== lead.status) await changeLeadStatusInTx(tx, actor, lead.id, target);

    await refreshLeadRollups(tx, lead.id);

    if (!isCoordinator(actor) && (d.feedback || d.objections || d.followUpAction)) {
      await notifyCoordinators(tx, {
        type: "NEW_FEEDBACK",
        title: `${rep.name} visited ${lead.businessName}: ${VISIT_OUTCOME_LABEL[d.outcome]}`,
        body: (d.feedback ?? d.objections ?? d.followUpAction ?? "").slice(0, 300),
        link: `/leads/${lead.id}?tab=visits`,
        dedupeKey: `feedback:${visit.id}`,
      });
    }
    return visit;
  }, { timeout: 20_000 });
}

export async function getVisitForFile(actor: Actor, id: string) {
  const v = await prisma.visit.findUnique({ where: { id }, include: { lead: true } });
  if (!v) throw notFound("Visit");
  assertLeadAccess(actor, v.lead);
  return v;
}
