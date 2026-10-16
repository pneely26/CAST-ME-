import type { Prisma, VisitOutcome } from "@prisma/client";
import { prisma } from "../db";
import { repScope, type Actor } from "../policy";
import { VISIT_OUTCOMES } from "@/lib/labels";
import type { DateRange } from "@/lib/time";
import { sp, type SP } from "./leadQuery";

export function visitWhere(actor: Actor, params: SP, range: DateRange): Prisma.VisitWhereInput {
  const and: Prisma.VisitWhereInput[] = [repScope(actor), { visitAt: { gte: range.start, lt: range.end } }];
  const outcome = sp(params, "outcome");
  if (outcome && (VISIT_OUTCOMES as string[]).includes(outcome)) and.push({ outcome: outcome as VisitOutcome });
  const rep = sp(params, "rep");
  if (rep && actor.role === "COORDINATOR") and.push({ repId: rep });
  const area = sp(params, "area");
  if (area) and.push({ lead: { areaId: area } });
  if (sp(params, "feedback") === "1") and.push({ OR: [{ feedback: { not: null } }, { objections: { not: null } }] });
  const q = sp(params, "q");
  if (q) and.push({ OR: [{ feedback: { contains: q, mode: "insensitive" } }, { objections: { contains: q, mode: "insensitive" } }, { notes: { contains: q, mode: "insensitive" } }, { lead: { businessName: { contains: q, mode: "insensitive" } } }] });
  return { AND: and };
}

export async function listVisits(actor: Actor, params: SP, range: DateRange, take = 200) {
  return prisma.visit.findMany({
    where: visitWhere(actor, params, range),
    include: { lead: { select: { id: true, businessName: true, area: { select: { name: true } } } }, rep: { select: { name: true } } },
    orderBy: { visitAt: "desc" },
    take,
  });
}
