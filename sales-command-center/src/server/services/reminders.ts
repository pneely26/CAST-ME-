import { prisma } from "../db";
import { getSettings } from "../settings";
import { notify, notifyCoordinators } from "./notifications";
import { ACTIVE_APPOINTMENT_STATUSES, CLOSED_STATUSES } from "@/lib/labels";
import { dateKeyInTz, dayRangeUtc, fmtDateTime, fmtTime, weekStartKey } from "@/lib/time";

export interface ReminderRun {
  followUpsDue: number;
  followUpsOverdue: number;
  appointmentsUpcoming: number;
  staleDigests: number;
  created: number;
}

/**
 * Create in-app reminders from current records. Safe to run any number of times: every reminder
 * has a dedupe key, so the same follow-up / appointment / week never produces a second copy.
 * In-app only — no email, SMS or push is sent (none are integrated).
 */
export async function runReminders(now = new Date()): Promise<ReminderRun> {
  const s = await getSettings();
  const tz = s.timezone;
  const today = dateKeyInTz(now, tz);
  const day = dayRangeUtc(today, today, tz);
  const before = await prisma.notification.count();
  const out: ReminderRun = { followUpsDue: 0, followUpsOverdue: 0, appointmentsUpcoming: 0, staleDigests: 0, created: 0 };

  const followUps = await prisma.followUp.findMany({
    where: { status: "OPEN", dueAt: { lt: day.end }, lead: { archivedAt: null, status: { not: "DO_NOT_CONTACT" } }, assignedTo: { active: true } },
    include: { lead: { select: { id: true, businessName: true } }, assignedTo: { select: { name: true } } },
    take: 2000,
  });
  for (const f of followUps) {
    const overdue = f.dueAt < day.start;
    await prisma.$transaction(async (tx) => {
      if (overdue) {
        out.followUpsOverdue++;
        await notify(tx, f.assignedToId, { type: "FOLLOW_UP_OVERDUE", title: `Overdue follow-up: ${f.lead.businessName}`, body: `${f.action} — was due ${fmtDateTime(f.dueAt, tz)}`, link: `/leads/${f.lead.id}?tab=overview`, dedupeKey: `fu-overdue:${f.id}` });
        await notifyCoordinators(tx, { type: "FOLLOW_UP_OVERDUE", title: `${f.assignedTo.name}'s follow-up is overdue: ${f.lead.businessName}`, body: `${f.action} — was due ${fmtDateTime(f.dueAt, tz)}`, link: `/follow-ups?due=overdue&rep=${f.assignedToId}`, dedupeKey: `fu-overdue:${f.id}` }, f.assignedToId);
      } else {
        out.followUpsDue++;
        await notify(tx, f.assignedToId, { type: "FOLLOW_UP_DUE", title: `Follow-up due today: ${f.lead.businessName}`, body: `${f.action}${f.dueAt > now ? ` — ${fmtTime(f.dueAt, tz)}` : ""}`, link: `/leads/${f.lead.id}?tab=overview`, dedupeKey: `fu-due:${f.id}:${today}` });
      }
    });
  }

  const soon = new Date(now.getTime() + s.reminderMinutesBefore * 60_000);
  const appts = await prisma.appointment.findMany({
    where: { status: { in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { gte: now, lte: soon }, rep: { active: true } },
    include: { lead: { select: { id: true, businessName: true, address: true } } },
  });
  for (const a of appts) {
    out.appointmentsUpcoming++;
    await prisma.$transaction((tx) =>
      notify(tx, a.repId, { type: "APPOINTMENT_UPCOMING", title: `Coming up at ${fmtTime(a.startAt, tz)}: ${a.lead.businessName}`, body: a.lead.address ?? undefined, link: `/appointments/${a.id}`, dedupeKey: `appt-upcoming:${a.id}:${a.startAt.toISOString()}` }),
    );
  }

  // weekly digest of assigned open leads not visited recently (one per rep per week)
  const stale = new Date(now.getTime() - s.staleVisitDays * 86_400_000);
  const week = weekStartKey(today, s.weekStartsOn);
  const groups = await prisma.lead.groupBy({
    by: ["assignedRepId"],
    where: { archivedAt: null, assignedRepId: { not: null }, status: { notIn: CLOSED_STATUSES }, lastVisitAt: { lt: stale } },
    _count: true,
  });
  const reps = await prisma.user.findMany({ where: { id: { in: groups.map((g) => g.assignedRepId!) }, active: true }, select: { id: true, name: true } });
  for (const g of groups) {
    const rep = reps.find((r) => r.id === g.assignedRepId);
    if (!rep) continue;
    out.staleDigests++;
    await prisma.$transaction(async (tx) => {
      await notify(tx, rep.id, { type: "LEAD_NOT_VISITED", title: `${g._count} of your leads haven't been visited in ${s.staleVisitDays}+ days`, link: `/leads?view=stale`, dedupeKey: `stale:${rep.id}:${week}` });
      await notifyCoordinators(tx, { type: "LEAD_NOT_VISITED", title: `${rep.name}: ${g._count} lead(s) not visited in ${s.staleVisitDays}+ days`, link: `/leads?view=stale&rep=${rep.id}`, dedupeKey: `stale:${rep.id}:${week}` });
    });
  }

  out.created = (await prisma.notification.count()) - before;
  await prisma.appSetting.upsert({ where: { key: "lastReminderRun" }, update: { value: now.toISOString() }, create: { key: "lastReminderRun", value: now.toISOString() } });
  return out;
}

let inFlight: Promise<unknown> | null = null;

/** Run reminders at most every `minutes` while people use the app, so they work without a cron job. */
export async function maybeRunReminders(minutes = 10) {
  if (inFlight) return;
  const last = await prisma.appSetting.findUnique({ where: { key: "lastReminderRun" } });
  if (last && Date.now() - new Date(String(last.value)).getTime() < minutes * 60_000) return;
  inFlight = runReminders()
    .catch((e) => console.error("[reminders] failed", e))
    .finally(() => (inFlight = null));
  await inFlight;
}

export async function lastReminderRun(): Promise<Date | null> {
  const last = await prisma.appSetting.findUnique({ where: { key: "lastReminderRun" } });
  return last ? new Date(String(last.value)) : null;
}
