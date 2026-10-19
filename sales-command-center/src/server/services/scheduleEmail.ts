import type { Lead } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { assertCan, type Actor } from "../policy";
import { invalid } from "../errors";
import { getSettings } from "../settings";
import { appUrl, emailStatus, sendEmail } from "../email";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/labels";
import { apptTimeRange, nextWorkDay, dateKeyInTz, dayRangeUtc, fmtDateKey, isDateKey, isTime, timeInTz, weekdayOf } from "@/lib/time";
import { formatPhone } from "@/lib/normalize";

/**
 * "Tomorrow's schedule" email: each rep gets their appointments and planned visits for the next work day,
 * with the lead's full details. Sent on request, or automatically at a set time once email is set up.
 */

export interface ScheduleEmailSettings {
  enabled: boolean;
  time: string; // "HH:MM" local time to send
  skipWeekends: boolean; // on Friday (and Saturday) send Monday's schedule
}
const KEY = "scheduleEmail";
const LAST_RUN_KEY = "scheduleEmailLastRun";
export const DEFAULT_SCHEDULE_EMAIL: ScheduleEmailSettings = { enabled: false, time: "17:00", skipWeekends: true };

export async function getScheduleEmailSettings(): Promise<ScheduleEmailSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const v = (row?.value ?? {}) as Partial<ScheduleEmailSettings>;
  return { enabled: v.enabled === true, time: isTime(v.time) ? v.time : DEFAULT_SCHEDULE_EMAIL.time, skipWeekends: v.skipWeekends !== false };
}

export async function saveScheduleEmailSettings(actor: Actor, s: ScheduleEmailSettings) {
  assertCan(actor, "settings.manage", "Only the coordinator can change the schedule email.");
  if (!isTime(s.time)) throw invalid("Choose a send time.");
  if (s.enabled && !emailStatus().configured) throw invalid("Set up email on the server first (see the instructions on this page) — otherwise nothing could be sent.");
  await prisma.$transaction(async (tx) => {
    await tx.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: { ...s } }, update: { value: { ...s } } });
    await audit(tx, actor, "settings.scheduleEmail", { type: "Setting", id: KEY }, s.enabled ? `Schedule email turned on: sent daily at ${s.time}${s.skipWeekends ? " (Friday sends Monday's)" : ""}` : "Automatic schedule email turned off");
  });
}


type ScheduleLead = Pick<Lead, "id" | "businessName" | "externalId" | "contactName" | "jobTitle" | "phone" | "cellPhone" | "email" | "address" | "address2" | "city" | "state" | "zip" | "employeeCount" | "businessVolume" | "industry" | "problems" | "yearsInBusiness" | "notes" | "latestFeedback">;
const LEAD_SELECT = { id: true, businessName: true, externalId: true, contactName: true, jobTitle: true, phone: true, cellPhone: true, email: true, address: true, address2: true, city: true, state: true, zip: true, employeeCount: true, businessVolume: true, industry: true, problems: true, yearsInBusiness: true, notes: true, latestFeedback: true } as const;

export interface ScheduleItem {
  kind: "appointment" | "visit";
  when: string; // "12:00 PM – 12:45 PM", "No set time", "Planned visit"
  status?: string;
  confirmedBy?: string | null;
  apptNotes?: string | null;
  lead: ScheduleLead;
}

export async function repSchedule(repId: string, dateKey: string) {
  const tz = (await getSettings()).timezone;
  const { start, end } = dayRangeUtc(dateKey, dateKey, tz);
  const [appts, plan] = await Promise.all([
    prisma.appointment.findMany({ where: { repId, status: { in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { gte: start, lt: end } }, orderBy: [{ timeSet: "desc" }, { startAt: "asc" }], include: { lead: { select: LEAD_SELECT } } }),
    prisma.dayPlan.findUnique({ where: { repId_date: { repId, date: dateKey } }, include: { area: { select: { name: true } }, territory: { select: { name: true } }, stops: { where: { status: "PLANNED" }, orderBy: { position: "asc" }, include: { lead: { select: LEAD_SELECT } } } } }),
  ]);
  const withAppt = new Set(appts.map((a) => a.leadId));
  const items: ScheduleItem[] = [
    ...appts.map((a) => ({ kind: "appointment" as const, when: a.timeSet ? apptTimeRange(a, tz) : "No set time", status: a.status === "CONFIRMED" ? "Confirmed" : "Scheduled", confirmedBy: a.confirmedBy, apptNotes: a.notes, lead: a.lead })),
    ...(plan?.stops ?? []).filter((s) => !withAppt.has(s.leadId)).map((s) => ({ kind: "visit" as const, when: "Planned visit", apptNotes: s.note, lead: s.lead })),
  ];
  const area = plan ? [plan.area?.name, plan.territory?.name].filter(Boolean).join(", ") || plan.label || null : null;
  return { items, area, startTime: plan?.startTime ?? null, routeNotes: plan?.routeNotes ?? null };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function leadRows(l: ScheduleLead): [string, string | null][] {
  return [
    ["Control Number", l.externalId],
    ["Prospect", [l.contactName, l.jobTitle].filter(Boolean).join(", ") || null],
    ["Address", [l.address, l.address2].filter(Boolean).join(", ") + ([l.city, l.state, l.zip].some(Boolean) ? `, ${[l.city, l.state].filter(Boolean).join(", ")} ${l.zip ?? ""}`.trimEnd() : "") || null],
    ["Telephone", l.phone ? formatPhone(l.phone) : null],
    ["Cell Phone", l.cellPhone ? formatPhone(l.cellPhone) : null],
    ["Email", l.email],
    ["Number of Employees", l.employeeCount != null ? String(l.employeeCount) : null],
    ["Business Volume ($ millions)", l.businessVolume],
    ["Type of Business", l.industry],
    ["Years in Business", l.yearsInBusiness != null ? String(l.yearsInBusiness) : null],
    ["Problems", l.problems],
    ["BC Notes", l.notes],
    ["Latest feedback", l.latestFeedback],
  ];
}

export function renderScheduleEmail(repName: string, dateKey: string, s: Awaited<ReturnType<typeof repSchedule>>, businessName: string) {
  const base = appUrl();
  const day = fmtDateKey(dateKey, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const subject = `Your schedule for ${day} — ${s.items.length} stop${s.items.length === 1 ? "" : "s"}`;
  const mapLink = (l: ScheduleLead) => {
    const q = [l.address, l.city, l.state, l.zip].filter(Boolean).join(", ");
    return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
  };
  const header = [s.area && `Area: ${s.area}`, s.startTime && `Start: ${s.startTime}`].filter(Boolean).join(" · ");

  const htmlItems = s.items
    .map((it, i) => {
      const l = it.lead;
      const rows = leadRows(l)
        .filter(([, v]) => v)
        .map(([k, v]) => {
          let val = esc(v).replace(/\n/g, "<br>");
          if (k === "Address" && mapLink(l)) val = `<a href="${esc(mapLink(l))}">${val}</a>`;
          if ((k === "Telephone" || k === "Cell Phone") && v) val = `<a href="tel:${esc(v.replace(/[^\d+]/g, ""))}">${val}</a>`;
          if (k === "Email" && v) val = `<a href="mailto:${esc(v)}">${val}</a>`;
          return `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:2px 0;vertical-align:top">${val}</td></tr>`;
        })
        .join("");
      const extra = [it.status && `<b>${esc(it.status)}</b>`, it.confirmedBy && `confirmed by ${esc(it.confirmedBy)}`].filter(Boolean).join(" ");
      const link = base ? `<div style="margin-top:6px"><a href="${esc(base)}/leads/${esc(l.id)}">Open in the app</a></div>` : "";
      return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 12px">
<div style="font-size:13px;color:#2563eb;font-weight:600">${i + 1}. ${esc(it.when)}${extra ? ` · <span style="color:#374151;font-weight:400">${extra}</span>` : ""}</div>
<div style="font-size:17px;font-weight:700;margin:2px 0 8px">${esc(l.businessName)}</div>
<table style="font-size:14px;border-collapse:collapse">${rows}${it.apptNotes ? `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;vertical-align:top">Appointment notes</td><td>${esc(it.apptNotes).replace(/\n/g, "<br>")}</td></tr>` : ""}</table>${link}</div>`;
    })
    .join("");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;margin:0;padding:16px;background:#f9fafb">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px">
<div style="font-size:12px;color:#6b7280">${esc(businessName)}</div>
<h1 style="font-size:20px;margin:4px 0">Hi ${esc(repName.split(" ")[0])}, here's your schedule for ${esc(day)}</h1>
${header ? `<p style="margin:4px 0 8px;color:#374151">${esc(header)}</p>` : ""}${s.routeNotes ? `<p style="margin:4px 0 12px;color:#374151">${esc(s.routeNotes).replace(/\n/g, "<br>")}</p>` : ""}
${s.items.length ? htmlItems : `<p>No appointments or planned visits.</p>`}
<p style="font-size:12px;color:#6b7280;margin-top:16px">Sent by ${esc(businessName)}. Changes after this email was sent are in the app.</p>
</div></body></html>`;

  const text = [
    `Your schedule for ${day}`,
    header,
    s.routeNotes ?? "",
    "",
    ...s.items.flatMap((it, i) => [
      `${i + 1}. ${it.when}${it.status ? ` (${it.status}${it.confirmedBy ? `, confirmed by ${it.confirmedBy}` : ""})` : ""} — ${it.lead.businessName}`,
      ...leadRows(it.lead).filter(([, v]) => v).map(([k, v]) => `   ${k}: ${v}`),
      ...(it.apptNotes ? [`   Appointment notes: ${it.apptNotes}`] : []),
      ...(base ? [`   ${base}/leads/${it.lead.id}`] : []),
      "",
    ]),
  ]
    .filter((x, i, a) => !(x === "" && a[i - 1] === ""))
    .join("\n");
  return { subject, html, text };
}

export interface SendResult {
  repId: string;
  repName: string;
  email: string;
  stops: number;
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

/** Email each chosen rep their schedule for `dateKey`. Reps with nothing scheduled are skipped. */
export async function sendScheduleEmails(actor: Actor | null, dateKey: string, repIds?: string[]): Promise<SendResult[]> {
  if (actor) assertCan(actor, "settings.manage", "Only the coordinator can send schedule emails.");
  if (!isDateKey(dateKey)) throw invalid("Choose a date.");
  if (!emailStatus().configured) throw invalid("Email isn't set up on the server yet, so nothing was sent.");
  const settings = await getSettings();
  const reps = await prisma.user.findMany({ where: { role: "REP", active: true, ...(repIds ? { id: { in: repIds } } : {}) }, orderBy: { name: "asc" } });
  const coordinator = actor ? await prisma.user.findUnique({ where: { id: actor.id }, select: { email: true } }) : null;
  const out: SendResult[] = [];
  for (const rep of reps) {
    const s = await repSchedule(rep.id, dateKey);
    const base = { repId: rep.id, repName: rep.name, email: rep.email, stops: s.items.length };
    if (!s.items.length) {
      out.push({ ...base, status: "skipped", reason: "Nothing scheduled" });
      continue;
    }
    const msg = renderScheduleEmail(rep.name, dateKey, s, settings.businessName);
    try {
      await sendEmail({ to: rep.email, ...msg, replyTo: coordinator?.email });
      out.push({ ...base, status: "sent" });
      await prisma.$transaction((tx) => audit(tx, actor, "email.schedule", { type: "User", id: rep.id }, `Emailed ${rep.name} their schedule for ${fmtDateKey(dateKey)} (${s.items.length} stop${s.items.length === 1 ? "" : "s"})${actor ? "" : " — automatic"}`));
    } catch (e) {
      out.push({ ...base, status: "failed", reason: e instanceof Error ? e.message.slice(0, 200) : "Send failed" });
      await prisma.$transaction((tx) => audit(tx, actor, "email.scheduleFailed", { type: "User", id: rep.id }, `Couldn't email ${rep.name} their schedule for ${fmtDateKey(dateKey)}`));
    }
  }
  return out;
}

/**
 * Called every few minutes (and by the cron endpoint): once a day, at or after the chosen time, emails every rep
 * their next-work-day schedule. A day is claimed before sending so it never goes out twice.
 */
export async function maybeSendScheduledEmails(now = new Date()) {
  if (!emailStatus().configured) return null;
  const cfg = await getScheduleEmailSettings();
  if (!cfg.enabled) return null;
  const tz = (await getSettings()).timezone;
  const today = dateKeyInTz(now, tz);
  if (timeInTz(now, tz) < cfg.time) return null;
  if (cfg.skipWeekends && [0, 6].includes(weekdayOf(today))) return null; // Friday already sent Monday's
  const claimed = await prisma.$transaction(async (tx) => {
    const last = await tx.appSetting.findUnique({ where: { key: LAST_RUN_KEY } });
    if (last?.value === today) return false;
    await tx.appSetting.upsert({ where: { key: LAST_RUN_KEY }, create: { key: LAST_RUN_KEY, value: today }, update: { value: today } });
    return true;
  }, { isolationLevel: "Serializable" }).catch(() => false);
  if (!claimed) return null;
  const forDay = nextWorkDay(today, cfg.skipWeekends);
  return { date: forDay, results: await sendScheduleEmails(null, forDay) };
}
