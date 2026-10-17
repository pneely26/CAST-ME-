import { z } from "zod";
import type { DayPlanStatus } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { audit } from "../audit";
import { assertWriter, assertLeadAccess, isCoordinator, type Actor } from "../policy";
import { forbidden, invalid, notFound } from "../errors";
import { refreshLeadRollups } from "./rollups";
import { notify } from "./notifications";
import { blocksOutreach } from "@/lib/domain/rollups";
import { differsFromTemplate, resolveWeek, type ResolvedDay } from "@/lib/domain/schedule";
import { addDays, isDateKey, isTime, weekdayOf, fmtDateKey } from "@/lib/time";
import { WEEKDAYS } from "@/lib/labels";

/** Coordinators manage any rep's schedule; a rep manages only their own. */
async function resolveRep(tx: Tx, actor: Actor, repId: string | null | undefined) {
  const id = isCoordinator(actor) ? repId : actor.id;
  if (!id) throw invalid("Choose a sales rep.");
  if (!isCoordinator(actor) && id !== actor.id) throw forbidden("You can only change your own schedule.");
  const rep = await tx.user.findUnique({ where: { id } });
  if (!rep || rep.role !== "REP") throw invalid("Schedules belong to a sales rep.");
  return rep;
}

const dayFields = z.object({
  label: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
  territoryId: z.string().optional().nullable().transform((v) => v || null),
  areaId: z.string().optional().nullable().transform((v) => v || null),
  startTime: z.string().optional().nullable().refine((v) => !v || isTime(v), "Use HH:MM for start time").transform((v) => v || null),
  endTime: z.string().optional().nullable().refine((v) => !v || isTime(v), "Use HH:MM for end time").transform((v) => v || null),
  visitTarget: z.number().int().min(0).max(200).optional().nullable().transform((v) => (v === undefined ? null : v)),
  notes: z.string().trim().max(2000).optional().nullable().transform((v) => v || null),
});
export type DayFields = z.input<typeof dayFields>;

async function normalizeArea<T extends { territoryId: string | null; areaId: string | null }>(tx: Tx, d: T): Promise<T> {
  if (d.areaId) {
    const a = await tx.area.findUnique({ where: { id: d.areaId } });
    if (!a) throw invalid("Area not found.");
    d.territoryId = a.territoryId;
  }
  return d;
}

export async function getActiveTemplate(tx: Tx, repId: string) {
  return tx.scheduleTemplate.findFirst({ where: { repId, active: true }, include: { days: true }, orderBy: { updatedAt: "desc" } });
}

/** Save the recurring weekly territory plan. Saved day plans (overrides) are not touched. */
export async function saveTemplate(actor: Actor, repId: string | null, days: (DayFields & { weekday: number })[], name = "Weekly territory plan") {
  assertWriter(actor);
  return prisma.$transaction(async (tx) => {
    const rep = await resolveRep(tx, actor, repId);
    let t = await getActiveTemplate(tx, rep.id);
    if (!t) t = await tx.scheduleTemplate.create({ data: { repId: rep.id, name }, include: { days: true } });
    for (const raw of days) {
      if (raw.weekday < 0 || raw.weekday > 6) throw invalid("Invalid weekday.");
      const d = await normalizeArea(tx, dayFields.parse(raw));
      const empty = !d.label && !d.areaId && !d.territoryId && !d.startTime && !d.endTime && d.visitTarget === null && !d.notes;
      if (empty) await tx.scheduleTemplateDay.deleteMany({ where: { templateId: t.id, weekday: raw.weekday } });
      else
        await tx.scheduleTemplateDay.upsert({
          where: { templateId_weekday: { templateId: t.id, weekday: raw.weekday } },
          update: d,
          create: { templateId: t.id, weekday: raw.weekday, ...d },
        });
    }
    await audit(tx, actor, "schedule.template", { type: "ScheduleTemplate", id: t.id }, `Updated ${rep.name}'s recurring weekly plan`);
    return t.id;
  });
}

/** Week (or any span) of resolved days with stops and appointments. */
export async function getSchedule(actor: Actor, repId: string, startKey: string, days: number) {
  if (!isCoordinator(actor) && repId !== actor.id) throw forbidden();
  const endKey = addDays(startKey, days - 1);
  const [template, plans] = await Promise.all([
    getActiveTemplate(prisma, repId),
    prisma.dayPlan.findMany({
      where: { repId, date: { gte: startKey, lte: endKey } },
      include: { stops: { orderBy: { position: "asc" }, include: { lead: { select: { id: true, businessName: true, address: true, city: true, status: true, phone: true, lastVisitAt: true, priority: true } } } }, area: true, territory: true },
    }),
  ]);
  const resolved = resolveWeek(startKey, days, template?.days ?? [], plans);
  const areaIds = [...new Set(resolved.map((r) => r.areaId).filter(Boolean))] as string[];
  const terrIds = [...new Set(resolved.map((r) => r.territoryId).filter(Boolean))] as string[];
  const [areas, territories] = await Promise.all([prisma.area.findMany({ where: { id: { in: areaIds } } }), prisma.territory.findMany({ where: { id: { in: terrIds } } })]);
  return resolved.map((r) => ({
    ...r,
    areaName: areas.find((a) => a.id === r.areaId)?.name ?? null,
    territoryName: territories.find((t) => t.id === r.territoryId)?.name ?? null,
    territoryColor: territories.find((t) => t.id === r.territoryId)?.color ?? null,
    stops: plans.find((p) => p.id === r.planId)?.stops ?? [],
  }));
}
export type ScheduleDay = Awaited<ReturnType<typeof getSchedule>>[number];

/** Make sure a saved DayPlan exists for a date (materialized from the template if needed). */
async function ensurePlan(tx: Tx, repId: string, date: string) {
  if (!isDateKey(date)) throw invalid("Invalid date.");
  const existing = await tx.dayPlan.findUnique({ where: { repId_date: { repId, date } } });
  if (existing) return existing;
  const t = await getActiveTemplate(tx, repId);
  const td = t?.days.find((d) => d.weekday === weekdayOf(date));
  return tx.dayPlan.create({
    data: { repId, date, label: td?.label ?? null, territoryId: td?.territoryId ?? null, areaId: td?.areaId ?? null, startTime: td?.startTime ?? null, endTime: td?.endTime ?? null, visitTarget: td?.visitTarget ?? null, routeNotes: td?.notes ?? null, isOverride: false },
  });
}

/** Edit one date. If it no longer matches the template it is an override; future weeks are unaffected. */
export async function saveDayPlan(actor: Actor, repId: string | null, date: string, raw: DayFields & { status?: DayPlanStatus }) {
  assertWriter(actor);
  return prisma.$transaction(async (tx) => {
    const rep = await resolveRep(tx, actor, repId);
    const d = await normalizeArea(tx, dayFields.parse(raw));
    const plan = await ensurePlan(tx, rep.id, date);
    const t = await getActiveTemplate(tx, rep.id);
    const td = t?.days.find((x) => x.weekday === weekdayOf(date));
    const isOverride = differsFromTemplate({ ...d, label: d.label }, td);
    const status = raw.status ?? (isOverride && plan.status === "PLANNED" ? "CHANGED" : plan.status);
    await tx.dayPlan.update({ where: { id: plan.id }, data: { label: d.label, territoryId: d.territoryId, areaId: d.areaId, startTime: d.startTime, endTime: d.endTime, visitTarget: d.visitTarget, routeNotes: d.notes, isOverride, status } });
    await audit(tx, actor, "schedule.day", { type: "DayPlan", id: plan.id }, `${rep.name}'s plan for ${fmtDateKey(date, { weekday: "short", month: "short", day: "numeric" })} updated${isOverride ? " (one-off change; recurring plan unchanged)" : ""}`);
    if (isCoordinator(actor) && rep.id !== actor.id && isOverride) {
      await notify(tx, rep.id, { type: "LEAD_ASSIGNED", title: `Schedule change for ${fmtDateKey(date, { weekday: "long", month: "short", day: "numeric" })}`, body: d.label ?? undefined, link: `/schedule?date=${date}`, dedupeKey: `day:${plan.id}:${Date.now()}` });
    }
    return plan.id;
  });
}

export async function setDayStatus(actor: Actor, repId: string | null, date: string, status: DayPlanStatus) {
  assertWriter(actor);
  return prisma.$transaction(async (tx) => {
    const rep = await resolveRep(tx, actor, repId);
    const plan = await ensurePlan(tx, rep.id, date);
    await tx.dayPlan.update({ where: { id: plan.id }, data: { status } });
    await audit(tx, actor, "schedule.dayStatus", { type: "DayPlan", id: plan.id }, `${fmtDateKey(date)} marked ${status.toLowerCase().replace("_", " ")}`);
  });
}

/** Go back to the recurring plan for this date (stops are kept). */
export async function resetDayToTemplate(actor: Actor, repId: string | null, date: string) {
  assertWriter(actor);
  return prisma.$transaction(async (tx) => {
    const rep = await resolveRep(tx, actor, repId);
    const plan = await tx.dayPlan.findUnique({ where: { repId_date: { repId: rep.id, date } } });
    if (!plan) return;
    const t = await getActiveTemplate(tx, rep.id);
    const td = t?.days.find((x) => x.weekday === weekdayOf(date));
    await tx.dayPlan.update({ where: { id: plan.id }, data: { label: td?.label ?? null, territoryId: td?.territoryId ?? null, areaId: td?.areaId ?? null, startTime: td?.startTime ?? null, endTime: td?.endTime ?? null, visitTarget: td?.visitTarget ?? null, routeNotes: td?.notes ?? null, isOverride: false, status: "PLANNED" } });
    await audit(tx, actor, "schedule.day", { type: "DayPlan", id: plan.id }, `${fmtDateKey(date)} reset to the recurring plan`);
  });
}

/** Coordinator assigns leads to a day; a rep may add their own assigned leads to their own day. */
export async function addStops(actor: Actor, repId: string | null, date: string, leadIds: string[]) {
  assertWriter(actor);
  if (!leadIds.length) throw invalid("Choose at least one lead.");
  return prisma.$transaction(async (tx) => {
    const rep = await resolveRep(tx, actor, repId);
    const plan = await ensurePlan(tx, rep.id, date);
    const max = await tx.dayPlanStop.aggregate({ where: { dayPlanId: plan.id }, _max: { position: true } });
    let pos = (max._max.position ?? -1) + 1;
    let added = 0;
    for (const leadId of leadIds) {
      const lead = await tx.lead.findUnique({ where: { id: leadId } });
      if (!lead || lead.archivedAt) continue;
      assertLeadAccess(actor, lead);
      if (blocksOutreach(lead.status)) throw invalid(`${lead.businessName} is marked Do Not Contact.`);
      if (lead.assignedRepId && lead.assignedRepId !== rep.id) throw invalid(`${lead.businessName} is assigned to another rep.`);
      const exists = await tx.dayPlanStop.findUnique({ where: { dayPlanId_leadId: { dayPlanId: plan.id, leadId } } });
      if (exists) continue;
      await tx.dayPlanStop.create({ data: { dayPlanId: plan.id, leadId, position: pos++ } });
      await audit(tx, actor, "schedule.stopAdded", { type: "DayPlanStop", id: plan.id, leadId }, `Planned visit on ${fmtDateKey(date, { weekday: "short", month: "short", day: "numeric" })} (${rep.name})`);
      await refreshLeadRollups(tx, leadId);
      added++;
    }
    if (added && isCoordinator(actor)) {
      await notify(tx, rep.id, { type: "LEAD_ASSIGNED", title: `${added} visit(s) added to ${fmtDateKey(date, { weekday: "long", month: "short", day: "numeric" })}`, link: `/schedule?date=${date}`, dedupeKey: `stops:${plan.id}:${Date.now()}` });
    }
    return added;
  });
}

export async function updateStop(actor: Actor, stopId: string, change: { status?: "PLANNED" | "SKIPPED"; move?: -1 | 1; remove?: boolean; note?: string | null }) {
  assertWriter(actor);
  return prisma.$transaction(async (tx) => {
    const stop = await tx.dayPlanStop.findUnique({ where: { id: stopId }, include: { dayPlan: true, lead: true } });
    if (!stop) throw notFound("Planned visit");
    await resolveRep(tx, actor, stop.dayPlan.repId);
    if (change.remove) {
      if (stop.status === "VISITED") throw invalid("This visit was already completed — it stays in the plan history.");
      await tx.dayPlanStop.delete({ where: { id: stopId } });
      await audit(tx, actor, "schedule.stopRemoved", { type: "DayPlanStop", id: stopId, leadId: stop.leadId }, `Removed from ${fmtDateKey(stop.dayPlan.date)} plan`);
    } else if (change.move) {
      const siblings = await tx.dayPlanStop.findMany({ where: { dayPlanId: stop.dayPlanId }, orderBy: { position: "asc" } });
      const i = siblings.findIndex((s) => s.id === stopId);
      const j = i + change.move;
      if (j >= 0 && j < siblings.length) {
        const order = [...siblings];
        [order[i], order[j]] = [order[j], order[i]];
        for (let k = 0; k < order.length; k++) await tx.dayPlanStop.update({ where: { id: order[k].id }, data: { position: k } });
      }
    } else if (change.status) {
      if (stop.status === "VISITED") throw invalid("Already visited.");
      await tx.dayPlanStop.update({ where: { id: stopId }, data: { status: change.status, note: change.note ?? stop.note } });
      if (change.status === "SKIPPED") await audit(tx, actor, "schedule.stopSkipped", { type: "DayPlanStop", id: stopId, leadId: stop.leadId }, `Planned visit skipped${change.note ? `: ${change.note}` : ""}`);
    }
    await refreshLeadRollups(tx, stop.leadId);
  });
}

/** Copy one week's day plans (territory, hours, targets, optionally planned leads) to another week. */
export async function copyWeek(actor: Actor, repId: string | null, fromStart: string, toStart: string, withStops: boolean) {
  assertWriter(actor);
  return prisma.$transaction(async (tx) => {
    const rep = await resolveRep(tx, actor, repId);
    let copied = 0;
    for (let i = 0; i < 7; i++) {
      const from = addDays(fromStart, i);
      const to = addDays(toStart, i);
      const src = await tx.dayPlan.findUnique({ where: { repId_date: { repId: rep.id, date: from } }, include: { stops: true } });
      if (!src) continue;
      const dest = await ensurePlan(tx, rep.id, to);
      await tx.dayPlan.update({ where: { id: dest.id }, data: { label: src.label, territoryId: src.territoryId, areaId: src.areaId, startTime: src.startTime, endTime: src.endTime, visitTarget: src.visitTarget, routeNotes: src.routeNotes, isOverride: src.isOverride, status: "PLANNED" } });
      if (withStops) {
        for (const s of src.stops) {
          const lead = await tx.lead.findUnique({ where: { id: s.leadId } });
          if (!lead || lead.archivedAt || blocksOutreach(lead.status)) continue;
          await tx.dayPlanStop.upsert({ where: { dayPlanId_leadId: { dayPlanId: dest.id, leadId: s.leadId } }, update: {}, create: { dayPlanId: dest.id, leadId: s.leadId, position: s.position } });
          await refreshLeadRollups(tx, s.leadId);
        }
      }
      copied++;
    }
    await audit(tx, actor, "schedule.copyWeek", { type: "DayPlan" }, `Copied ${copied} day plan(s) for ${rep.name} from week of ${fmtDateKey(fromStart)} to week of ${fmtDateKey(toStart)}${withStops ? " (with planned leads)" : ""}`);
    return copied;
  });
}

/** Save a week's actual day plans as the new recurring template. */
export async function weekToTemplate(actor: Actor, repId: string | null, weekStart: string) {
  assertWriter(actor);
  const rep = await prisma.$transaction((tx) => resolveRep(tx, actor, repId));
  const days = await getSchedule(actor, rep.id, weekStart, 7);
  return saveTemplate(
    actor,
    rep.id,
    days.map((d: ResolvedDay) => ({ weekday: weekdayOf(d.date), label: d.label, territoryId: d.territoryId, areaId: d.areaId, startTime: d.startTime, endTime: d.endTime, visitTarget: d.visitTarget, notes: d.notes })),
  );
}

export function weekdayName(i: number) {
  return WEEKDAYS[i];
}
