import { prisma } from "../db";
import type { Actor } from "../policy";
import type { AppSettings } from "../settings";
import { ACTIVE_APPOINTMENT_STATUSES, CLOSED_STATUSES, IN_PERSON_TYPES } from "@/lib/labels";
import { addDays, dateKeyInTz, dayRangeUtc, resolveRange, weekStartKey, type DateRange } from "@/lib/time";
import { summarizeSales } from "@/lib/domain/sales";

/** All dashboard numbers come straight from database records within the user's scope. */
export async function dashboardData(actor: Actor, settings: AppSettings, range: DateRange, now = new Date()) {
  const tz = settings.timezone;
  const isRep = actor.role === "REP";
  const leadScope = isRep ? { assignedRepId: actor.id } : {};
  const repScope = isRep ? { repId: actor.id } : {};
  const today = dateKeyInTz(now, tz);
  const todayRange = dayRangeUtc(today, today, tz);
  const weekStart = weekStartKey(today, settings.weekStartsOn);
  const week = dayRangeUtc(weekStart, addDays(weekStart, 6), tz);
  const month = resolveRange("month", undefined, undefined, tz, now);
  const stale = new Date(now.getTime() - settings.staleVisitDays * 86_400_000);
  const openLead = { archivedAt: null, status: { notIn: CLOSED_STATUSES } };

  const [
    activeLeads,
    assignedLeads,
    todayStops,
    todayAppointments,
    completedVisits,
    upcoming,
    changedAppts,
    neverVisited,
    staleLeads,
    followUpsDue,
    overdueFollowUps,
    recentFeedback,
    pendingReschedules,
    opps,
    recentSales,
    weekVisits,
    weekStops,
    weekAppts,
  ] = await Promise.all([
    prisma.lead.count({ where: { ...leadScope, ...openLead } }),
    prisma.lead.count({ where: { ...openLead, ...(isRep ? { assignedRepId: actor.id } : { assignedRepId: { not: null } }) } }),
    prisma.dayPlanStop.findMany({
      where: { dayPlan: { date: today, ...(isRep ? { repId: actor.id } : {}) }, lead: { archivedAt: null } },
      include: { lead: { select: { id: true, businessName: true, address: true, city: true, status: true } }, dayPlan: { include: { rep: { select: { name: true } }, area: true } } },
      orderBy: { position: "asc" },
    }),
    prisma.appointment.findMany({ where: { ...repScope, status: { in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { gte: todayRange.start, lt: todayRange.end } }, include: { lead: { select: { id: true, businessName: true } }, rep: { select: { name: true } } }, orderBy: { startAt: "asc" } }),
    prisma.visit.count({ where: { ...repScope, type: { in: IN_PERSON_TYPES }, visitAt: { gte: range.start, lt: range.end } } }),
    prisma.appointment.findMany({ where: { ...repScope, status: { in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { gte: now, lt: new Date(now.getTime() + 14 * 86_400_000) } }, include: { lead: { select: { id: true, businessName: true } }, rep: { select: { name: true } } }, orderBy: { startAt: "asc" }, take: 8 }),
    prisma.appointmentChange.findMany({
      where: { action: { in: ["MOVED", "CANCELED"] }, createdAt: { gte: new Date(now.getTime() - 14 * 86_400_000) }, appointment: repScope },
      include: { appointment: { include: { lead: { select: { id: true, businessName: true } } } }, changedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.lead.count({ where: { ...leadScope, ...openLead, lastVisitAt: null } }),
    prisma.lead.count({ where: { ...leadScope, ...openLead, lastVisitAt: { lt: stale } } }),
    prisma.followUp.findMany({
      where: { status: "OPEN", dueAt: { lt: todayRange.end }, ...(isRep ? { assignedToId: actor.id } : {}), lead: { archivedAt: null } },
      include: { lead: { select: { id: true, businessName: true } }, assignedTo: { select: { name: true } } },
      orderBy: { dueAt: "asc" },
      take: 8,
    }),
    prisma.followUp.count({ where: { status: "OPEN", dueAt: { lt: todayRange.start }, ...(isRep ? { assignedToId: actor.id } : {}), lead: { archivedAt: null } } }),
    prisma.visit.findMany({ where: { ...repScope, OR: [{ feedback: { not: null } }, { objections: { not: null } }] }, include: { lead: { select: { id: true, businessName: true } }, rep: { select: { name: true } } }, orderBy: { visitAt: "desc" }, take: 6 }),
    prisma.rescheduleRequest.findMany({ where: { status: "PENDING", ...(isRep ? { requestedById: actor.id } : {}) }, include: { lead: { select: { id: true, businessName: true } }, requestedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 6 }),
    prisma.opportunity.findMany({ where: { ...repScope, archivedAt: null }, select: { id: true, status: true, estimatedValue: true, finalAmount: true, closedAt: true, openedAt: true, leadId: true, repId: true, product: true, commissionAmount: true, isDemo: true } }),
    prisma.opportunity.findMany({ where: { ...repScope, archivedAt: null, status: "WON" }, include: { lead: { select: { id: true, businessName: true } }, rep: { select: { name: true } } }, orderBy: { closedAt: "desc" }, take: 6 }),
    prisma.visit.findMany({ where: { ...repScope, visitAt: { gte: week.start, lt: week.end } }, select: { visitAt: true, type: true } }),
    prisma.dayPlanStop.findMany({ where: { dayPlan: { date: { gte: weekStart, lte: addDays(weekStart, 6) }, ...(isRep ? { repId: actor.id } : {}) } }, select: { status: true, dayPlan: { select: { date: true } } } }),
    prisma.appointment.findMany({ where: { ...repScope, startAt: { gte: week.start, lt: week.end }, status: { not: "CANCELED" } }, select: { startAt: true, status: true } }),
  ]);

  const nums = opps.map((o) => ({ ...o, estimatedValue: o.estimatedValue ? Number(o.estimatedValue) : null, finalAmount: o.finalAmount ? Number(o.finalAmount) : null, commissionAmount: o.commissionAmount ? Number(o.commissionAmount) : null }));
  const salesWeek = summarizeSales(nums, week);
  const salesMonth = summarizeSales(nums, month);
  const salesRange = summarizeSales(nums, range);
  const salesAll = summarizeSales(nums);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    return {
      date,
      planned: weekStops.filter((s) => s.dayPlan.date === date).length,
      visited: weekVisits.filter((v) => dateKeyInTz(v.visitAt, tz) === date && IN_PERSON_TYPES.includes(v.type)).length,
      calls: weekVisits.filter((v) => dateKeyInTz(v.visitAt, tz) === date && v.type === "PHONE_CALL").length,
      appointments: weekAppts.filter((a) => dateKeyInTz(a.startAt, tz) === date).length,
    };
  });

  return {
    today,
    activeLeads,
    assignedLeads,
    todayStops,
    todayAppointments,
    plannedToday: todayStops.length + todayAppointments.length,
    completedToday: todayStops.filter((s) => s.status === "VISITED").length,
    completedVisits,
    upcoming,
    changedAppts,
    neverVisited,
    staleLeads,
    followUpsDue,
    followUpsDueCount: followUpsDue.length,
    overdueFollowUps,
    recentFeedback,
    pendingReschedules,
    salesWeek,
    salesMonth,
    salesRange,
    salesAll,
    recentSales,
    weekDays,
    hasDemo: opps.some((o) => o.isDemo),
  };
}
