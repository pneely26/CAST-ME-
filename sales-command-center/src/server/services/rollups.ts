import type { Tx } from "../db";
import { computeRollups } from "@/lib/domain/rollups";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/labels";
import { zonedToUtc } from "@/lib/time";
import { getSettings } from "../settings";

/**
 * Recompute a lead's summary columns from its complete history.
 * Called inside the same transaction as every change to visits, follow-ups,
 * appointments or day-plan stops, so list views and the dashboard never drift.
 */
export async function refreshLeadRollups(tx: Tx, leadId: string, now = new Date()) {
  const settings = await getSettings(tx);
  const [visits, followUps, appointments, stops] = await Promise.all([
    tx.visit.findMany({ where: { leadId }, select: { visitAt: true, type: true, outcome: true, feedback: true } }),
    tx.followUp.findMany({ where: { leadId, status: "OPEN" }, select: { dueAt: true } }),
    tx.appointment.findMany({ where: { leadId, status: { in: ACTIVE_APPOINTMENT_STATUSES } }, select: { startAt: true } }),
    tx.dayPlanStop.findMany({ where: { leadId, status: "PLANNED" }, select: { dayPlan: { select: { date: true, startTime: true } } } }),
  ]);
  const r = computeRollups({
    visits,
    openFollowUpDue: followUps.map((f) => f.dueAt),
    activeAppointmentStarts: appointments.map((a) => a.startAt),
    plannedStopDates: stops.map((s) => zonedToUtc(s.dayPlan.date, s.dayPlan.startTime ?? "09:00", settings.timezone)),
    now,
  });
  await tx.lead.update({ where: { id: leadId }, data: r });
  return r;
}
