import { prisma } from "../db";
import { assertCan, type Actor } from "../policy";
import type { DateRange } from "@/lib/time";
import { fmtDateKey } from "@/lib/time";

/** A gap this long between pages starts a new "opened the app" session. */
const SESSION_GAP_MS = 30 * 60_000;

export interface ActivityEvent {
  at: Date;
  kind: "login" | "logout" | "failed" | "view" | "change";
  text: string;
  href?: string;
  device?: string | null;
}

export interface ActivitySession {
  start: Date;
  end: Date;
  device: string | null;
  events: ActivityEvent[];
  pages: number;
}

const TAB_LABEL: Record<string, string> = { overview: "overview", contact: "contact info", visits: "visit history", notes: "notes & feedback", appointments: "appointments", sales: "sales", activity: "activity" };

/** Turn app paths into plain descriptions, looking up the names of the leads / appointments / sales involved. */
async function describePaths(paths: string[]): Promise<Map<string, { text: string; href?: string }>> {
  const ids = { lead: new Set<string>(), appt: new Set<string>(), opp: new Set<string>() };
  for (const p of paths) {
    const [path] = p.split("?");
    const m = path.match(/^\/(leads|appointments|sales)\/(c[a-z0-9]{20,})/);
    if (m) (m[1] === "leads" ? ids.lead : m[1] === "appointments" ? ids.appt : ids.opp).add(m[2]);
  }
  const [leads, appts, opps] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: [...ids.lead] } }, select: { id: true, businessName: true } }),
    prisma.appointment.findMany({ where: { id: { in: [...ids.appt] } }, select: { id: true, lead: { select: { businessName: true } } } }),
    prisma.opportunity.findMany({ where: { id: { in: [...ids.opp] } }, select: { id: true, product: true, lead: { select: { businessName: true } } } }),
  ]);
  const leadName = new Map(leads.map((l) => [l.id, l.businessName]));
  const apptName = new Map(appts.map((a) => [a.id, a.lead.businessName]));
  const oppName = new Map(opps.map((o) => [o.id, `${o.product} (${o.lead.businessName})`]));
  const out = new Map<string, { text: string; href?: string }>();
  for (const p of paths) {
    const [path, qs = ""] = p.split("?");
    const q = new URLSearchParams(qs);
    let text = `Opened ${path}`;
    let m: RegExpMatchArray | null;
    if (path === "/") text = "Opened the dashboard";
    else if (path === "/today") text = "Opened Today's route";
    else if (path === "/leads") text = q.get("q") ? `Searched leads for “${q.get("q")}”` : q.get("view") ? `Browsed leads (${q.get("view")})` : "Browsed leads";
    else if ((m = path.match(/^\/leads\/(c[a-z0-9]+)(\/(edit|visit))?$/))) {
      const name = leadName.get(m[1]) ?? "a lead (since removed)";
      const tab = q.get("tab");
      text = m[3] ? `Tried to ${m[3] === "edit" ? "edit" : "record a visit on"} ${name} (view-only)` : `Viewed lead ${name}${tab && tab !== "overview" ? ` — ${TAB_LABEL[tab] ?? tab}` : ""}`;
    } else if ((m = path.match(/^\/appointments\/(c[a-z0-9]+)$/))) text = `Viewed appointment — ${apptName.get(m[1]) ?? "removed"}`;
    else if (path === "/appointments") text = "Opened appointments";
    else if ((m = path.match(/^\/sales\/(c[a-z0-9]+)$/))) text = `Viewed sale — ${oppName.get(m[1]) ?? "removed"}`;
    else if (path === "/sales") text = "Opened sales";
    else if (path === "/schedule") text = "Opened the schedule / calendar";
    else if ((m = path.match(/^\/schedule\/day\/(\d{4}-\d{2}-\d{2})$/))) text = `Viewed the plan for ${fmtDateKey(m[1])}`;
    else if (path === "/visits") text = "Opened visit history";
    else if (path === "/follow-ups") text = "Opened follow-ups";
    else if (path === "/reschedules") text = "Opened reschedule requests";
    else if (path === "/reports") text = "Opened reports";
    else if (path === "/notifications") text = "Opened notifications";
    else if (path === "/settings") text = "Opened their account settings";
    const href = path.match(/^\/(leads|appointments|sales)\/c[a-z0-9]+$/) ? path : undefined;
    out.set(p, { text, href });
  }
  return out;
}

export async function repLastSeen(userIds: string[]): Promise<Map<string, Date>> {
  const [views, logins] = await Promise.all([
    prisma.pageView.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _max: { createdAt: true } }),
    prisma.auditLog.groupBy({ by: ["actorId"], where: { actorId: { in: userIds }, action: "auth.login" }, _max: { createdAt: true } }),
  ]);
  const out = new Map<string, Date>();
  for (const v of views) if (v._max.createdAt) out.set(v.userId, v._max.createdAt);
  for (const l of logins) if (l.actorId && l._max.createdAt && (!out.get(l.actorId) || l._max.createdAt > out.get(l.actorId)!)) out.set(l.actorId, l._max.createdAt);
  return out;
}

/** Coordinator-only: what reps did in the app — sign-ins, sessions and the pages they opened. */
export async function repActivity(actor: Actor, repId: string, range: DateRange) {
  assertCan(actor, "audit.view", "Only the coordinator can see rep activity.");
  const when = range.preset === "all" ? {} : { createdAt: { gte: range.start, lt: range.end } };
  const [views, logs] = await Promise.all([
    prisma.pageView.findMany({ where: { userId: repId, ...when }, orderBy: { createdAt: "asc" }, take: 5000 }),
    prisma.auditLog.findMany({ where: { actorId: repId, ...when }, orderBy: { createdAt: "asc" }, take: 2000 }),
  ]);
  const described = await describePaths([...new Set(views.map((v) => v.path))]);
  const events: ActivityEvent[] = [
    ...views.map((v) => ({ at: v.createdAt, kind: "view" as const, ...described.get(v.path)!, device: v.device })),
    ...logs.map((l) => ({
      at: l.createdAt,
      kind: (l.action === "auth.login" ? "login" : l.action === "auth.logout" ? "logout" : l.action === "auth.failed" ? "failed" : "change") as ActivityEvent["kind"],
      text: l.summary,
      device: (l.data as { device?: string } | null)?.device ?? null,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  // group into sessions: a sign-in, or a gap of 30+ minutes, starts a new one
  const sessions: ActivitySession[] = [];
  for (const e of events) {
    const cur = sessions[sessions.length - 1];
    if (!cur || e.kind === "login" || e.at.getTime() - cur.end.getTime() > SESSION_GAP_MS) {
      sessions.push({ start: e.at, end: e.at, device: e.device ?? null, events: [e], pages: e.kind === "view" ? 1 : 0 });
    } else {
      cur.events.push(e);
      cur.end = e.at;
      if (e.kind === "view") cur.pages++;
      if (!cur.device && e.device) cur.device = e.device;
    }
  }
  return {
    sessions: sessions.reverse(), // newest first
    totals: { signIns: events.filter((e) => e.kind === "login").length, failed: events.filter((e) => e.kind === "failed").length, sessions: sessions.length, pages: views.length },
  };
}

/** Keep the page-view log from growing forever (activity older than a year is removed). */
export async function prunePageViews(days = 365) {
  await prisma.pageView.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
}
