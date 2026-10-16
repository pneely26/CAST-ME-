import type { OpportunityStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { repScope, type Actor } from "../policy";
import { sp, type SP } from "./leadQuery";
import { OPEN_OPPORTUNITY_STATUSES, OPPORTUNITY_STATUSES } from "@/lib/labels";
import type { DateRange } from "@/lib/time";

/**
 * Sales list filter. Date range applies to close date for won/lost deals and to opened date
 * for open opportunities, so "sales in October" means deals closed in October.
 */
export function oppWhere(actor: Actor, params: SP, range: DateRange): Prisma.OpportunityWhereInput {
  const and: Prisma.OpportunityWhereInput[] = [repScope(actor), { archivedAt: null }];
  const view = sp(params, "view") ?? (sp(params, "status") ? "status" : "all");
  const status = sp(params, "status");
  if (view === "open") and.push({ status: { in: OPEN_OPPORTUNITY_STATUSES } });
  else if (view === "closed") and.push({ status: { in: ["WON", "LOST"] } });
  if (status && (OPPORTUNITY_STATUSES as string[]).includes(status)) and.push({ status: status as OpportunityStatus });
  if (range.preset !== "all") {
    and.push({
      OR: [
        { status: { in: ["WON", "LOST"] }, closedAt: { gte: range.start, lt: range.end } },
        { status: { in: OPEN_OPPORTUNITY_STATUSES }, ...(view === "open" ? {} : { openedAt: { lt: range.end } }) },
      ],
    });
  }
  const rep = sp(params, "rep");
  if (rep && actor.role === "COORDINATOR") and.push({ repId: rep });
  const area = sp(params, "area");
  if (area) and.push({ lead: { areaId: area } });
  const product = sp(params, "product");
  if (product) and.push({ product: { contains: product, mode: "insensitive" } });
  const q = sp(params, "q");
  if (q) and.push({ OR: [{ product: { contains: q, mode: "insensitive" } }, { lead: { businessName: { contains: q, mode: "insensitive" } } }, { notes: { contains: q, mode: "insensitive" } }] });
  return { AND: and };
}

export async function listOpportunities(actor: Actor, params: SP, range: DateRange, take = 500) {
  return prisma.opportunity.findMany({
    where: oppWhere(actor, params, range),
    include: { lead: { select: { id: true, businessName: true, area: { select: { name: true } } } }, rep: { select: { name: true } } },
    orderBy: [{ closedAt: { sort: "desc", nulls: "first" } }, { openedAt: "desc" }],
    take,
  });
}
