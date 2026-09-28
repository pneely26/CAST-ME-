import type { WatchType } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { REGION_LABELS, humanize, type RegionCode } from "../constants";
import { normalizeOffice } from "../normalize";

export interface ActivityItem {
  key: string;
  watchId: string;
  watchLabel: string;
  date: Date;
  text: string;
  link: string;
  kind: "PUBLIC_BREAKDOWN" | "AGENCY_SUBMISSION" | "PROJECT";
}

export function watchLabel(w: { type: WatchType; value: string }) {
  if (w.type === "REGION") return `Region · ${REGION_LABELS[w.value as RegionCode] ?? w.value}`;
  return `${humanize(w.type)} · ${w.value}`;
}

export async function addWatch(type: WatchType, value: string, refs: { castingDirectorId?: string; projectId?: string } = {}) {
  const v = value.trim();
  if (!v) throw new Error("Watch value is required.");
  const existing = await prisma.watchlistItem.findUnique({ where: { type_value: { type, value: v } } });
  if (existing) return existing;
  const w = await prisma.watchlistItem.create({ data: { type, value: v, castingDirectorId: refs.castingDirectorId ?? null, projectId: refs.projectId ?? null } });
  await audit("WATCHLIST_ADDED", "WatchlistItem", w.id, `Watching ${watchLabel(w)}`);
  return w;
}

export async function removeWatch(id: string) {
  const w = await prisma.watchlistItem.findUnique({ where: { id } });
  if (!w) return;
  await prisma.watchlistItem.delete({ where: { id } });
  await audit("WATCHLIST_REMOVED", "WatchlistItem", id, `Stopped watching ${watchLabel(w)}`);
}

/** Recent public breakdowns / agency submissions touching anything on the watchlist. */
export async function getWatchlistActivity(days = 30, now = new Date()): Promise<ActivityItem[]> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const watches = await prisma.watchlistItem.findMany();
  if (watches.length === 0) return [];
  const breakdowns = await prisma.publicBreakdown.findMany({
    where: { OR: [{ importedAt: { gte: since } }, { postedDate: { gte: since } }] },
    include: { project: { include: { castings: { include: { castingDirector: true } } } } },
  });
  const submissions = await prisma.agencySubmission.findMany({
    where: { OR: [{ importedAt: { gte: since } }, { dateSubmitted: { gte: since } }] },
    include: { project: { include: { castings: true } } },
  });

  const items: ActivityItem[] = [];
  for (const w of watches) {
    const label = watchLabel(w);
    for (const b of breakdowns) {
      const p = b.project;
      let hit = false;
      if (w.type === "CASTING_DIRECTOR") hit = p.castings.some((c) => c.castingDirectorId === w.castingDirectorId);
      if (w.type === "CASTING_OFFICE") {
        const key = normalizeOffice(w.value);
        hit = [b.castingOfficeRaw, ...p.castings.map((c) => c.castingOffice), ...p.castings.map((c) => c.castingDirector.castingOffice)].some(
          (o) => o && normalizeOffice(o) === key,
        );
      }
      if (w.type === "PLATFORM") hit = (p.platform ?? "").toLowerCase() === w.value.toLowerCase();
      if (w.type === "REGION") hit = (b.region ?? p.region) === w.value;
      if (w.type === "PROJECT") hit = p.id === w.projectId;
      if (hit)
        items.push({
          key: `bd:${b.id}`,
          watchId: w.id,
          watchLabel: label,
          date: b.postedDate ?? b.importedAt,
          text: `Public breakdown: ${p.title}${b.roleName ? ` — ${b.roleName}` : ""} (${b.source})`,
          link: `/opportunities/${b.id}`,
          kind: "PUBLIC_BREAKDOWN",
        });
    }
    for (const s of submissions) {
      let hit = false;
      if (w.type === "CASTING_DIRECTOR") hit = Boolean(s.project?.castings.some((c) => c.castingDirectorId === w.castingDirectorId));
      if (w.type === "PLATFORM") hit = (s.platform ?? s.project?.platform ?? "").toLowerCase() === w.value.toLowerCase();
      if (w.type === "REGION") hit = s.region === w.value;
      if (w.type === "PROJECT") hit = s.projectId === w.projectId;
      if (hit)
        items.push({
          key: `sub:${s.id}`,
          watchId: w.id,
          watchLabel: label,
          date: s.dateSubmitted ?? s.importedAt,
          text: `Agency submission: ${s.projectTitleRaw}${s.role ? ` — ${s.role}` : ""}`,
          link: `/submissions#${s.id}`,
          kind: "AGENCY_SUBMISSION",
        });
    }
  }
  return items.sort((a, b) => b.date.getTime() - a.date.getTime());
}
