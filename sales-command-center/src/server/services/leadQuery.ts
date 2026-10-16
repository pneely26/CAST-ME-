import type { LeadPriority, LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { leadScope, type Actor } from "../policy";
import { LEAD_STATUSES, PRIORITIES, OPEN_OPPORTUNITY_STATUSES, ACTIVE_APPOINTMENT_STATUSES } from "@/lib/labels";
import { dayRangeUtc, dateKeyInTz, isDateKey, addDays } from "@/lib/time";
import type { AppSettings } from "../settings";

export type SP = Record<string, string | string[] | undefined>;

export function sp(params: SP, k: string): string | undefined {
  const v = params[k];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim().slice(0, 200) : undefined;
}

export const BUILT_IN_VIEWS: { key: string; label: string; coordinatorOnly?: boolean; query: string }[] = [
  { key: "all", label: "All Leads", query: "" },
  { key: "mine", label: "Assigned Leads", query: "view=mine" },
  { key: "by-area", label: "Leads by Area", query: "view=by-area&sort=area" },
  { key: "never", label: "Never Visited", query: "view=never" },
  { key: "stale", label: "Not Visited in 30+ Days", query: "view=stale" },
  { key: "followups", label: "Follow-Ups Due", query: "view=followups&sort=followup" },
  { key: "appointments", label: "Upcoming Appointments", query: "view=appointments&sort=appointment" },
  { key: "reschedules", label: "Reschedules", query: "view=reschedules" },
  { key: "interested", label: "Interested Leads", query: "view=interested" },
  { key: "opportunities", label: "Open Opportunities", query: "view=opportunities" },
  { key: "won", label: "Won Sales", query: "view=won" },
  { key: "lost", label: "Lost Leads", query: "view=lost" },
  { key: "archived", label: "Archived", query: "view=archived", coordinatorOnly: true },
];

export const SORTS: Record<string, { label: string; orderBy: Prisma.LeadOrderByWithRelationInput[] }> = {
  updated: { label: "Recently updated", orderBy: [{ updatedAt: "desc" }] },
  name: { label: "Business name", orderBy: [{ businessName: "asc" }] },
  lastVisit: { label: "Last visit (recent first)", orderBy: [{ lastVisitAt: { sort: "desc", nulls: "last" } }] },
  untouched: { label: "Oldest untouched", orderBy: [{ lastContactAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }] },
  appointment: { label: "Upcoming appointment", orderBy: [{ nextAppointmentAt: { sort: "asc", nulls: "last" } }] },
  followup: { label: "Follow-up due", orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }] },
  priority: { label: "Priority", orderBy: [{ priority: "desc" }, { updatedAt: "desc" }] },
  area: { label: "Area", orderBy: [{ area: { name: "asc" } }, { businessName: "asc" }] },
  created: { label: "Newest", orderBy: [{ createdAt: "desc" }] },
};

/** Translate URL filters into a Prisma query, always inside the actor's scope. */
export function buildLeadWhere(actor: Actor, params: SP, settings: AppSettings, now = new Date()): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [leadScope(actor)];
  const view = sp(params, "view");
  const tz = settings.timezone;
  const today = dateKeyInTz(now, tz);
  const endOfToday = dayRangeUtc(today, today, tz).end;
  const stale = new Date(now.getTime() - settings.staleVisitDays * 86_400_000);

  if (view === "archived") and.push({ archivedAt: { not: null } });
  else and.push({ archivedAt: null });

  switch (view) {
    case "mine":
      // rep: their own leads; coordinator: every lead that has been assigned to a rep
      and.push(actor.role === "REP" ? { assignedRepId: actor.id } : { assignedRepId: { not: null } });
      break;
    case "never":
      and.push({ lastVisitAt: null, status: { notIn: ["DO_NOT_CONTACT", "NOT_A_FIT", "LOST", "WON"] } });
      break;
    case "stale":
      and.push({ lastVisitAt: { lt: stale }, status: { notIn: ["DO_NOT_CONTACT", "NOT_A_FIT", "LOST"] } });
      break;
    case "followups":
      and.push({ nextFollowUpAt: { lt: endOfToday } });
      break;
    case "appointments":
      and.push({ nextAppointmentAt: { gte: now } });
      break;
    case "reschedules":
      and.push({ reschedules: { some: { createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } } } });
      break;
    case "interested":
      and.push({ status: { in: ["INTERESTED", "OPPORTUNITY_IN_PROGRESS"] } });
      break;
    case "opportunities":
      and.push({ opportunities: { some: { status: { in: OPEN_OPPORTUNITY_STATUSES }, archivedAt: null } } });
      break;
    case "won":
      and.push({ OR: [{ status: "WON" }, { opportunities: { some: { status: "WON", archivedAt: null } } }] });
      break;
    case "lost":
      and.push({ status: "LOST" });
      break;
  }

  const q = sp(params, "q");
  if (q) {
    const ci = { contains: q, mode: "insensitive" as const };
    const digits = q.replace(/\D/g, "");
    const num = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;
    and.push({
      OR: [
        { businessName: ci },
        { externalId: ci },
        { contactName: ci },
        { email: ci },
        { address: ci },
        { city: ci },
        { notes: ci },
        { latestFeedback: ci },
        { tags: { has: q } },
        ...(digits.length >= 3 ? [{ normalizedPhone: { contains: digits } }] : []),
        ...(num ? [{ leadNumber: num }] : []),
      ],
    });
  }
  const territory = sp(params, "territory");
  if (territory) and.push({ territoryId: territory === "none" ? null : territory });
  const area = sp(params, "area");
  if (area) and.push({ areaId: area === "none" ? null : area });
  const status = sp(params, "status");
  if (status && (LEAD_STATUSES as string[]).includes(status)) and.push({ status: status as LeadStatus });
  const priority = sp(params, "priority");
  if (priority && (PRIORITIES as string[]).includes(priority)) and.push({ priority: priority as LeadPriority });
  const rep = sp(params, "rep");
  if (rep && actor.role === "COORDINATOR") and.push({ assignedRepId: rep === "none" ? null : rep });
  const tag = sp(params, "tag");
  if (tag) and.push({ tags: { has: tag } });

  const visitedFrom = sp(params, "visitedFrom");
  const visitedTo = sp(params, "visitedTo");
  if (isDateKey(visitedFrom)) and.push({ lastVisitAt: { gte: dayRangeUtc(visitedFrom, visitedFrom, tz).start } });
  if (isDateKey(visitedTo)) and.push({ lastVisitAt: { lt: dayRangeUtc(visitedTo, visitedTo, tz).end } });
  const visited = sp(params, "visited");
  if (visited === "never") and.push({ lastVisitAt: null });
  if (visited === "stale") and.push({ lastVisitAt: { lt: stale } });
  const followUp = sp(params, "followUp");
  if (followUp === "overdue") and.push({ nextFollowUpAt: { lt: dayRangeUtc(today, today, tz).start } });
  if (followUp === "today") and.push({ nextFollowUpAt: { gte: dayRangeUtc(today, today, tz).start, lt: endOfToday } });
  if (followUp === "week") and.push({ nextFollowUpAt: { lt: dayRangeUtc(addDays(today, 7), addDays(today, 7), tz).end } });
  if (followUp === "none") and.push({ nextFollowUpAt: null });
  return { AND: and };
}

export async function listLeads(actor: Actor, params: SP, settings: AppSettings, opts: { pageSize?: number; all?: boolean } = {}) {
  const where = buildLeadWhere(actor, params, settings);
  const sortKey = sp(params, "sort") ?? (sp(params, "view") === "by-area" ? "area" : "updated");
  const sort = SORTS[sortKey] ?? SORTS.updated;
  const pageSize = opts.pageSize ?? 50;
  const page = Math.max(1, Number(sp(params, "page") ?? 1) || 1);
  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [...sort.orderBy, { id: "asc" }],
      include: { area: { select: { id: true, name: true } }, territory: { select: { id: true, name: true, color: true } }, assignedRep: { select: { id: true, name: true } } },
      skip: opts.all ? 0 : (page - 1) * pageSize,
      take: opts.all ? 10000 : pageSize,
    }),
  ]);
  return { total, rows, page, pageSize, sortKey };
}

export { ACTIVE_APPOINTMENT_STATUSES };
