import { prisma } from "../db";
import type { Actor } from "../policy";
import { sp, type SP } from "./leadQuery";
import { CLOSED_STATUSES, IN_PERSON_TYPES, LEAD_STATUSES, LEAD_STATUS_LABEL, VISIT_OUTCOMES, VISIT_OUTCOME_LABEL } from "@/lib/labels";
import { addDays, dateKeyInTz, daysBetween, monthStartKey, weekStartKey, type DateRange } from "@/lib/time";
import { conversionRate, groupSum, round2, summarizeSales } from "@/lib/domain/sales";

/**
 * Report metric definitions (shown on the Reports page so numbers are never ambiguous):
 * - New leads: leads created in the range (not archived).
 * - Leads by status: current status of every active lead in scope (a snapshot, not range-bound).
 * - Visits: in-person visits dated in the range; phone calls are counted separately.
 * - Planned vs completed: route stops on day plans dated in the range.
 * - Follow-ups: follow-ups due in the range — done, still open, or canceled.
 * - Appointments: appointments scheduled to start in the range. Kept = completed; kept rate = completed / (completed + no-show).
 * - Reschedules: appointment moves recorded in the range, plus reschedule requests made in the range.
 * - Sales: deals closed won/lost in the range (by close date). Revenue = final amounts of closed-won deals only.
 *   Pipeline = estimated value of currently open opportunities, never added to revenue.
 * - Not visited recently: active leads never visited or not visited within the stale-lead setting.
 * - Conversion: distinct leads with a won sale in the range ÷ new leads in the range.
 */

type Scope = { repId?: string };

function scopeFor(actor: Actor, params: SP): Scope {
  if (actor.role === "REP") return { repId: actor.id };
  const rep = sp(params, "rep");
  return rep ? { repId: rep } : {};
}

const inRange = (range: DateRange) => (range.preset === "all" ? undefined : { gte: range.start, lt: range.end });

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function loadOpps(scope: Scope) {
  const rows = await prisma.opportunity.findMany({
    where: { ...scope, archivedAt: null },
    select: { id: true, status: true, estimatedValue: true, finalAmount: true, closedAt: true, openedAt: true, leadId: true, repId: true, product: true, commissionAmount: true, isDemo: true },
  });
  return rows.map((o) => ({ ...o, estimatedValue: num(o.estimatedValue), finalAmount: num(o.finalAmount), commissionAmount: num(o.commissionAmount) }));
}

/** Sales-only figures (also used by tests). */
export async function salesReport(actor: Actor, params: SP, range: DateRange) {
  const scope = scopeFor(actor, params);
  const opps = await loadOpps(scope);
  const r = range.preset === "all" ? undefined : range;
  return { opps, summary: summarizeSales(opps, r) };
}

export type Bucket = "day" | "week" | "month";

function bucketFor(range: DateRange, firstKey?: string): Bucket {
  const span = range.preset === "all" ? (firstKey ? daysBetween(firstKey, range.endKey) : 999) : daysBetween(range.startKey, range.endKey);
  return span > 92 ? "month" : span > 21 ? "week" : "day";
}

function bucketKey(d: Date, tz: string, b: Bucket) {
  const k = dateKeyInTz(d, tz);
  return b === "day" ? k : b === "week" ? weekStartKey(k) : monthStartKey(k);
}

/** Every bucket key between two date keys, so empty periods show as zero instead of disappearing. */
function bucketKeys(startKey: string, endKey: string, b: Bucket) {
  const keys: string[] = [];
  let k = b === "day" ? startKey : b === "week" ? weekStartKey(startKey) : monthStartKey(startKey);
  let guard = 0;
  while (k <= endKey && guard++ < 400) {
    keys.push(k);
    if (b === "day") k = addDays(k, 1);
    else if (b === "week") k = addDays(k, 7);
    else k = monthStartKey(addDays(k, 32));
  }
  return keys;
}

export async function reportData(actor: Actor, params: SP, range: DateRange, opts: { tz: string; staleDays: number }, now = new Date()) {
  const tz = opts.tz;
  const scope = scopeFor(actor, params);
  const leadScope = scope.repId ? { assignedRepId: scope.repId } : {};
  const at = inRange(range);
  const dayKeys = range.preset === "all" ? undefined : { gte: range.startKey, lte: range.endKey };

  const [newLeads, activeLeads, visits, stops, followUps, appts, moves, requests, opps, reps, overdueFollowUps] = await Promise.all([
    prisma.lead.findMany({ where: { ...leadScope, archivedAt: null, ...(at ? { createdAt: at } : {}) }, select: { id: true, createdAt: true, area: { select: { name: true } } } }),
    prisma.lead.groupBy({ by: ["status"], where: { ...leadScope, archivedAt: null }, _count: true }),
    prisma.visit.findMany({ where: { ...scope, ...(at ? { visitAt: at } : {}) }, select: { visitAt: true, type: true, outcome: true, repId: true } }),
    prisma.dayPlanStop.findMany({ where: { dayPlan: { ...scope, ...(dayKeys ? { date: dayKeys } : {}) } }, select: { status: true } }),
    prisma.followUp.findMany({ where: { ...(scope.repId ? { assignedToId: scope.repId } : {}), ...(at ? { dueAt: at } : {}), lead: { archivedAt: null } }, select: { status: true, dueAt: true, completedAt: true, assignedToId: true } }),
    prisma.appointment.findMany({ where: { ...scope, ...(at ? { startAt: at } : {}) }, select: { status: true, repId: true } }),
    prisma.appointmentChange.count({ where: { action: "MOVED", ...(at ? { createdAt: at } : {}), appointment: scope } }),
    prisma.rescheduleRequest.groupBy({ by: ["status"], where: { ...(scope.repId ? { requestedById: scope.repId } : {}), ...(at ? { createdAt: at } : {}) }, _count: true }),
    loadOpps(scope),
    prisma.user.findMany({ where: { role: "REP", ...(scope.repId ? { id: scope.repId } : {}) }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
    prisma.followUp.count({ where: { status: "OPEN", dueAt: { lt: now }, ...(scope.repId ? { assignedToId: scope.repId } : {}), lead: { archivedAt: null } } }),
  ]);

  const r = range.preset === "all" ? undefined : range;
  const sales = summarizeSales(opps, r);
  const closedIn = (d: Date | null) => !!d && (!r || (d >= r.start && d < r.end));
  const wonInRange = opps.filter((o) => o.status === "WON" && closedIn(o.closedAt));
  const oppsCreated = opps.filter((o) => !r || (o.openedAt >= r.start && o.openedAt < r.end)).length;

  // lead volume
  const leadsByArea = groupSum(newLeads, (l) => l.area?.name ?? "No area", () => 1).map((g) => ({ key: g.key, count: g.count }));
  const statusCounts = new Map(activeLeads.map((g) => [g.status, g._count]));
  const leadsByStatus = LEAD_STATUSES.map((s) => ({ key: LEAD_STATUS_LABEL[s], status: s, count: statusCounts.get(s) ?? 0, closed: CLOSED_STATUSES.includes(s) })).filter((x) => x.count > 0);

  // visits
  const inPerson = visits.filter((v) => IN_PERSON_TYPES.includes(v.type));
  const phoneCalls = visits.length - inPerson.length;
  const firstVisitKey = visits.length ? dateKeyInTz(new Date(Math.min(...visits.map((v) => v.visitAt.getTime()))), tz) : undefined;
  const bucket = bucketFor(range, firstVisitKey);
  const visitStart = range.preset === "all" ? (firstVisitKey ?? range.endKey) : range.startKey;
  const visitEnd = range.preset === "all" ? dateKeyInTz(now, tz) : range.endKey;
  const visitSeries = new Map(bucketKeys(visitStart, visitEnd, bucket).map((k) => [k, 0]));
  for (const v of inPerson) {
    const k = bucketKey(v.visitAt, tz, bucket);
    visitSeries.set(k, (visitSeries.get(k) ?? 0) + 1);
  }
  const outcomeCounts = new Map<string, number>();
  for (const v of visits) outcomeCounts.set(v.outcome, (outcomeCounts.get(v.outcome) ?? 0) + 1);
  const visitOutcomes = VISIT_OUTCOMES.map((o) => ({ key: VISIT_OUTCOME_LABEL[o], count: outcomeCounts.get(o) ?? 0 })).filter((x) => x.count > 0);

  const planned = { total: stops.length, visited: stops.filter((s) => s.status === "VISITED").length, skipped: stops.filter((s) => s.status === "SKIPPED").length, pending: stops.filter((s) => s.status === "PLANNED").length };

  // follow-ups
  const fuDone = followUps.filter((f) => f.status === "DONE").length;
  const fuOpen = followUps.filter((f) => f.status === "OPEN");
  const fu = {
    due: followUps.length,
    done: fuDone,
    open: fuOpen.length,
    overdueInRange: fuOpen.filter((f) => f.dueAt < now).length,
    canceled: followUps.filter((f) => f.status === "CANCELED").length,
    completionRate: fuDone + fuOpen.length ? fuDone / (fuDone + fuOpen.length) : null,
  };
  const staleLeadsSince = new Date(now.getTime() - opts.staleDays * 86_400_000);
  const neverOrStale = await prisma.lead.count({ where: { ...leadScope, archivedAt: null, status: { notIn: CLOSED_STATUSES }, OR: [{ lastVisitAt: null }, { lastVisitAt: { lt: staleLeadsSince } }] } });

  // appointments
  const count = (s: string) => appts.filter((a) => a.status === s).length;
  const ap = {
    booked: appts.length,
    scheduled: count("SCHEDULED") + count("CONFIRMED"),
    kept: count("COMPLETED"),
    noShow: count("NO_SHOW"),
    canceled: count("CANCELED"),
    keptRate: count("COMPLETED") + count("NO_SHOW") ? count("COMPLETED") / (count("COMPLETED") + count("NO_SHOW")) : null,
    moves,
    requests: Object.fromEntries(requests.map((g) => [g.status, g._count])) as Record<string, number>,
  };

  // revenue by period (closed-won only, by close date)
  const firstWonKey = wonInRange.length ? dateKeyInTz(new Date(Math.min(...wonInRange.map((o) => o.closedAt!.getTime()))), tz) : undefined;
  const salesBucket = bucketFor(range, firstWonKey);
  const revStart = range.preset === "all" ? (firstWonKey ?? dateKeyInTz(now, tz)) : range.startKey;
  const revEnd = range.preset === "all" ? dateKeyInTz(now, tz) : range.endKey;
  const revenueSeries = new Map(bucketKeys(revStart, revEnd, salesBucket).map((k) => [k, { count: 0, total: 0 }]));
  for (const o of wonInRange) {
    const k = bucketKey(o.closedAt!, tz, salesBucket);
    const e = revenueSeries.get(k) ?? { count: 0, total: 0 };
    e.count++;
    e.total = round2(e.total + (o.finalAmount ?? 0));
    revenueSeries.set(k, e);
  }
  const revenueByProduct = groupSum(wonInRange, (o) => o.product, (o) => o.finalAmount ?? 0);

  // rep activity
  const repActivity = reps.map((rep) => {
    const repWon = wonInRange.filter((o) => o.repId === rep.id);
    return {
      id: rep.id,
      name: rep.name,
      active: rep.active,
      visits: inPerson.filter((v) => v.repId === rep.id).length,
      calls: visits.filter((v) => v.repId === rep.id && !IN_PERSON_TYPES.includes(v.type)).length,
      apptsKept: appts.filter((a) => a.repId === rep.id && a.status === "COMPLETED").length,
      followUpsDone: followUps.filter((f) => f.assignedToId === rep.id && f.status === "DONE").length,
      won: repWon.length,
      revenue: round2(repWon.reduce((s, o) => s + (o.finalAmount ?? 0), 0)),
    };
  });

  return {
    scope,
    hasDemo: opps.some((o) => o.isDemo),
    leads: { newCount: newLeads.length, byArea: leadsByArea, byStatus: leadsByStatus, overdueFollowUps, neverOrStale },
    visits: { inPerson: inPerson.length, phoneCalls, bucket, series: [...visitSeries.entries()].map(([key, count]) => ({ key, count })), outcomes: visitOutcomes, planned },
    followUps: fu,
    appointments: ap,
    sales: {
      summary: sales,
      oppsCreated,
      conversion: conversionRate(newLeads.length, wonInRange.map((o) => o.leadId)),
      bucket: salesBucket,
      revenueSeries: [...revenueSeries.entries()].map(([key, v]) => ({ key, ...v })),
      byProduct: revenueByProduct,
    },
    repActivity,
  };
}

export type ReportData = Awaited<ReturnType<typeof reportData>>;
