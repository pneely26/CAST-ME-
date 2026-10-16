import Link from "next/link";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { can } from "@/server/policy";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { RescheduleBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { cancelRescheduleAction, resolveRescheduleAction } from "@/app/actions/appointments";
import { dateKeyInTz, fmtDateTime, timeInTz } from "@/lib/time";

export const metadata = { title: "Reschedules" };

export default async function ReschedulesPage() {
  const actor = await requireActor();
  const tz = (await getSettings()).timezone;
  const mine = actor.role === "REP" ? { requestedById: actor.id } : {};
  const isCoord = can(actor, "reschedule.resolve");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const include = { lead: { select: { id: true, businessName: true } }, requestedBy: { select: { name: true } }, resolvedBy: { select: { name: true } }, appointment: { select: { id: true, startAt: true, status: true, rep: { select: { name: true } } } } } as const;
  const [pending, recent, changes] = await Promise.all([
    prisma.rescheduleRequest.findMany({ where: { status: "PENDING", ...mine }, include, orderBy: { createdAt: "asc" } }),
    prisma.rescheduleRequest.findMany({ where: { status: { not: "PENDING" }, updatedAt: { gte: since }, ...mine }, include, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.appointmentChange.findMany({
      where: { action: { in: ["MOVED", "CANCELED"] }, createdAt: { gte: since }, ...(actor.role === "REP" ? { appointment: { repId: actor.id } } : {}) },
      include: { appointment: { include: { lead: { select: { id: true, businessName: true } } } }, changedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title={isCoord ? "Reschedules" : "My reschedule requests"} subtitle="Original appointment times are always kept in the appointment history." />
      <Section title={`Pending (${pending.length})`} subtitle={isCoord ? "Approve to move the appointment (the same appointment — no duplicate is created), or decline with a note." : "Waiting for the coordinator."}>
        {pending.length === 0 ? <Empty>No pending requests.</Empty> : (
          <ul className="divide-y divide-line-2">
            {pending.map((r) => (
              <li key={r.id} id={r.id} className="scroll-mt-20 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link className="font-medium hover:underline" href={`/appointments/${r.appointmentId}`}>{r.lead.businessName}</Link>
                  <RescheduleBadge s="PENDING" />
                  <span className="text-xs text-muted">requested by {r.requestedBy.name} · {fmtDateTime(r.createdAt, tz)}</span>
                </div>
                <div className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                  <div><span className="text-xs text-muted">Current time: </span>{fmtDateTime(r.originalStart, tz)}</div>
                  <div><span className="text-xs text-muted">Requested: </span><strong>{fmtDateTime(r.requestedStart, tz)}</strong></div>
                  <div className="sm:col-span-2"><span className="text-xs text-muted">Reason: </span>{r.reason}</div>
                </div>
                {isCoord ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <ActionForm action={resolveRescheduleAction} className="rounded-md border border-line p-3">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <div className="text-sm font-medium">Approve</div>
                      <details className="mt-1 text-sm">
                        <summary className="cursor-pointer text-xs text-accent">Approve a different time instead</summary>
                        <input type="hidden" name="editTime" value="" />
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <input type="date" name="date" defaultValue={dateKeyInTz(r.requestedStart, tz)} className="input" aria-label="Date" />
                          <input type="time" name="time" defaultValue={timeInTz(r.requestedStart, tz)} className="input" aria-label="Time" />
                          <input type="number" name="minutes" min={5} max={720} defaultValue={Math.round((r.requestedEnd.getTime() - r.requestedStart.getTime()) / 60000)} className="input" aria-label="Minutes" />
                        </div>
                        <label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" name="editTime" value="on" /> Use this time</label>
                      </details>
                      <input name="notes" className="input mt-2" placeholder="Note to the rep (optional)" />
                      <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" name="allowOverlap" /> Approve even if it overlaps another appointment</label>
                      <SubmitButton className="btn-primary mt-2">Approve</SubmitButton>
                    </ActionForm>
                    <ActionForm action={resolveRescheduleAction} className="rounded-md border border-line p-3">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="decline" />
                      <div className="text-sm font-medium">Decline</div>
                      <input name="notes" required className="input mt-2" placeholder="Why? (sent to the rep)" />
                      <SubmitButton className="btn-danger mt-2">Decline</SubmitButton>
                    </ActionForm>
                  </div>
                ) : (
                  <ActionForm action={cancelRescheduleAction} className="mt-2"><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn-ghost btn-sm">Withdraw request</SubmitButton></ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Recent decisions" subtitle="Last 30 days">
          {recent.length === 0 ? <Empty>None.</Empty> : (
            <ul className="divide-y divide-line-2">
              {recent.map((r) => (
                <li key={r.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><Link className="font-medium hover:underline" href={`/appointments/${r.appointmentId}`}>{r.lead.businessName}</Link><RescheduleBadge s={r.status} /></div>
                  <div className="text-xs text-muted">{fmtDateTime(r.originalStart, tz)} → {fmtDateTime(r.finalStart ?? r.requestedStart, tz)} · {r.requestedBy.name}{r.resolvedBy ? ` · decided by ${r.resolvedBy.name}` : ""}</div>
                  {r.resolutionNotes && <div className="text-xs text-ink-2">{r.resolutionNotes}</div>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Recent schedule changes" subtitle="Moves and cancellations, last 30 days">
          {changes.length === 0 ? <Empty>None.</Empty> : (
            <ul className="divide-y divide-line-2">
              {changes.map((c) => (
                <li key={c.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><Link className="font-medium hover:underline" href={`/appointments/${c.appointmentId}`}>{c.appointment.lead.businessName}</Link><Badge tone={c.action === "MOVED" ? "warn" : "muted"}>{c.action === "MOVED" ? "Rescheduled" : "Canceled"}</Badge></div>
                  <div className="text-xs text-muted">{c.action === "MOVED" ? `${fmtDateTime(c.fromStart, tz)} → ${fmtDateTime(c.toStart, tz)}` : `was ${fmtDateTime(c.fromStart, tz)}`} · {c.changedBy.name} · {fmtDateTime(c.createdAt, tz)}</div>
                  {c.reason && <div className="text-xs text-ink-2">{c.reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
