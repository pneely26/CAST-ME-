import { prisma } from "../server/db";
import { extraChannels, type AlertMessage } from "./channels";
import { daysUntil } from "../deadlines";
import { getWatchlistActivity } from "../server/watchlist";

/** Store an alert in-app (idempotent via dedupeKey) and fan out to extra channels. */
export async function emitAlert(a: AlertMessage): Promise<boolean> {
  const exists = await prisma.alert.findUnique({ where: { dedupeKey: a.dedupeKey } });
  if (exists) return false;
  const delivered = ["in_app"];
  for (const ch of extraChannels) {
    if (!ch.enabled()) continue;
    try {
      await ch.deliver(a);
      delivered.push(ch.id);
    } catch (e) {
      console.error(`[alerts] channel ${ch.id} failed`, e);
    }
  }
  await prisma.alert.create({ data: { ...a, link: a.link ?? null, deliveredTo: delivered } });
  return true;
}

/** Scan current data and emit any new alerts. Safe to run repeatedly (deduplicated). */
export async function generateAlerts(now = new Date()) {
  let created = 0;
  const deadlineDays = Number(process.env.DEADLINE_ALERT_DAYS ?? 3);

  // NEW_MATCH: open breakdowns with HIGH/POSSIBLE relevance
  const matches = await prisma.publicBreakdown.findMany({
    where: { relevance: { in: ["HIGH", "POSSIBLE"] }, visibility: { not: "CLOSED" }, OR: [{ submissionDeadline: null }, { submissionDeadline: { gte: now } }] },
    include: { project: true },
  });
  for (const b of matches) {
    if (
      await emitAlert({
        type: "NEW_MATCH",
        title: `${b.relevance === "HIGH" ? "High" : "Possible"} relevance: ${b.project.title}${b.roleName ? ` — ${b.roleName}` : ""}`,
        body: `${b.project.platform ?? "Platform not listed"} · ${b.region ?? "Region not listed"} · based on explicit breakdown details`,
        link: `/opportunities/${b.id}`,
        dedupeKey: `NEW_MATCH:${b.id}:${b.relevance}`,
      })
    )
      created++;
  }

  // DEADLINE_APPROACHING
  const soon = await prisma.publicBreakdown.findMany({
    where: { visibility: { not: "CLOSED" }, submissionDeadline: { gte: now, lte: new Date(now.getTime() + deadlineDays * 86_400_000 + 86_400_000) } },
    include: { project: true },
  });
  for (const b of soon) {
    const d = daysUntil(b.submissionDeadline!, now);
    if (d > deadlineDays) continue;
    if (
      await emitAlert({
        type: "DEADLINE_APPROACHING",
        title: `Deadline ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}: ${b.project.title}`,
        body: `${b.roleName ?? "Role not listed"} · ${b.source}`,
        link: `/opportunities/${b.id}`,
        dedupeKey: `DEADLINE:${b.id}:${b.submissionDeadline!.toISOString().slice(0, 10)}`,
      })
    )
      created++;
  }

  // POTENTIAL_BLIND_SPOT
  const spots = await prisma.blindSpot.findMany({
    where: { classification: { in: ["AGENCY_REPORTED_NOT_FOUND", "NEEDS_REVIEW"] }, reviewStatus: "UNREVIEWED" },
    include: { project: true },
  });
  for (const s of spots) {
    if (
      await emitAlert({
        type: "POTENTIAL_BLIND_SPOT",
        title: `${s.classification === "NEEDS_REVIEW" ? "Needs review" : "Potential blind spot"}: ${s.project.title}`,
        body: s.classification === "NEEDS_REVIEW" ? "Uncertain match against public dataset — review required." : "Agency-reported project not found in current public dataset.",
        link: `/blind-spots/${s.id}`,
        dedupeKey: `BLINDSPOT:${s.id}:${s.classification}`,
      })
    )
      created++;
  }

  // WATCHLIST_ACTIVITY
  const activity = await getWatchlistActivity(14, now);
  for (const a of activity) {
    if (
      await emitAlert({
        type: "WATCHLIST_ACTIVITY",
        title: `Watchlist: ${a.watchLabel}`,
        body: a.text,
        link: a.link,
        dedupeKey: `WATCH:${a.watchId}:${a.key}`,
      })
    )
      created++;
  }

  // REPEAT_CASTING_DIRECTOR: 3+ distinct projects in 90 days
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const cds = await prisma.castingDirector.findMany({
    include: { castings: { where: { project: { OR: [{ discoveredAt: { gte: since } }, { breakdowns: { some: { importedAt: { gte: since } } } }] } } } },
  });
  for (const cd of cds) {
    const n = cd.castings.length;
    if (n < 3) continue;
    if (
      await emitAlert({
        type: "REPEAT_CASTING_DIRECTOR",
        title: `Repeat casting director: ${cd.name}`,
        body: `${n} projects in the last 90 days (activity frequency only — not a ranking).`,
        link: `/casting-directors/${cd.id}`,
        dedupeKey: `REPEAT_CD:${cd.id}:${n >= 5 ? "5" : "3"}`,
      })
    )
      created++;
  }
  return created;
}
