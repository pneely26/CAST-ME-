import type { Prisma, Region, Relevance } from "@prisma/client";
import { REGIONS } from "../constants";

export type SP = Record<string, string | string[] | undefined>;

export function str(sp: SP, k: string): string | undefined {
  const v = sp[k];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim().slice(0, 200) : undefined;
}

export function region(sp: SP, k = "region"): Region | undefined {
  const v = str(sp, k);
  return v && (REGIONS as readonly string[]).includes(v) ? (v as Region) : undefined;
}

export function day(sp: SP, k: string): Date | undefined {
  const v = str(sp, k);
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(v + "T00:00:00Z");
  return isNaN(d.getTime()) ? undefined : d;
}

const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });

/** Build a Prisma where-clause for public breakdowns from URL filters. */
export function breakdownWhere(sp: SP, now = new Date()): Prisma.PublicBreakdownWhereInput {
  const and: Prisma.PublicBreakdownWhereInput[] = [];
  const q = str(sp, "q");
  if (q)
    and.push({
      OR: [
        { project: { title: ci(q) } },
        { roleName: ci(q) },
        { characterDescription: ci(q) },
        { castingDirectorRaw: ci(q) },
        { castingOfficeRaw: ci(q) },
        { source: ci(q) },
      ],
    });
  const r = region(sp);
  if (r) and.push({ OR: [{ region: r }, { region: null, project: { region: r } }] });
  const platform = str(sp, "platform");
  if (platform) and.push({ project: { platform: { equals: platform, mode: "insensitive" } } });
  const union = str(sp, "union");
  if (union) and.push({ OR: [{ unionStatus: ci(union) }, { project: { unionStatus: ci(union) } }] });
  const pt = str(sp, "productionType");
  if (pt) and.push({ project: { productionType: ci(pt) } });
  const cd = str(sp, "cd");
  if (cd) and.push({ OR: [{ castingDirectorRaw: ci(cd) }, { castingOfficeRaw: ci(cd) }, { project: { castings: { some: { castingDirector: { name: ci(cd) } } } } }] });
  const rel = str(sp, "relevance");
  if (rel && ["HIGH", "POSSIBLE", "LOW"].includes(rel)) and.push({ relevance: rel as Relevance });
  const from = day(sp, "from");
  const to = day(sp, "to");
  if (from) and.push({ OR: [{ postedDate: { gte: from } }, { postedDate: null, importedAt: { gte: from } }] });
  if (to) and.push({ OR: [{ postedDate: { lte: new Date(to.getTime() + 86_399_999) } }, { postedDate: null, importedAt: { lte: new Date(to.getTime() + 86_399_999) } }] });
  const status = sp.status === undefined ? "open" : (str(sp, "status") ?? "all");
  if (status === "open") and.push({ visibility: { not: "CLOSED" }, OR: [{ submissionDeadline: null }, { submissionDeadline: { gte: now } }] });
  if (status === "closed") and.push({ OR: [{ visibility: "CLOSED" }, { submissionDeadline: { lt: now } }] });
  return and.length ? { AND: and } : {};
}
