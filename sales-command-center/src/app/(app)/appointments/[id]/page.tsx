import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { assertLeadAccess, assertOwnOrCoordinator, can } from "@/server/policy";
import { Badge, Empty, Flash, KV, PageHeader, Section } from "@/components/ui";
import { ApptStatusBadge, RescheduleBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { appointmentDetailsAction, appointmentStatusAction, cancelRescheduleAction, moveAppointmentAction, requestRescheduleAction } from "@/app/actions/appointments";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/labels";
import { dateKeyInTz, fmtDateTime, fmtTime, timeInTz, apptRange } from "@/lib/time";
import { WriteOnly } from "@/components/ReadOnly";

export const metadata = { title: "Appointment" };

const CHANGE_LABEL: Record<string, string> = { CREATED: "Booked", EDITED: "Edited", MOVED: "Rescheduled", CANCELED: "Canceled", COMPLETED: "Completed", NO_SHOW: "No-show", RESTORED: "Restored" };

export default async function AppointmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const { msg } = await searchParams;
  const actor = await requireActor();
  const tz = (await getSettings()).timezone;
  const a = await prisma.appointment.findUnique({
    where: { id },
    include: {
      lead: true,
      rep: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      changes: { orderBy: { createdAt: "asc" }, include: { changedBy: { select: { name: true } } } },
      reschedules: { orderBy: { createdAt: "desc" }, include: { requestedBy: { select: { name: true } }, resolvedBy: { select: { name: true } } } },
      visitsFrom: { select: { id: true, visitAt: true } },
    },
  });
  if (!a) notFound();
  try {
    assertLeadAccess(actor, a.lead);
    assertOwnOrCoordinator(actor, a.repId);
  } catch {
    notFound();
  }
  const active = ACTIVE_APPOINTMENT_STATUSES.includes(a.status);
  const isCoord = can(actor, "appointment.moveDirect");
  const pending = a.reschedules.find((r) => r.status === "PENDING");
  const minutes = Math.round((a.endAt.getTime() - a.startAt.getTime()) / 60000);
  const original = a.changes.find((c) => c.action === "CREATED");

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: "/appointments", label: "Appointments" }}
        title={<span>{a.lead.businessName}</span>}
        subtitle={<span className="flex flex-wrap items-center gap-2"><ApptStatusBadge s={a.status} />{a.changes.some((c) => c.action === "MOVED") && <Badge tone="warn">Rescheduled</Badge>}{pending && <RescheduleBadge s="PENDING" />}{fmtDateTime(a.startAt, tz)}–{fmtTime(a.endAt, tz)} · {a.rep.name}</span>}
        actions={
          <>
            <Link href={`/leads/${a.leadId}`} className="btn-secondary">Open lead</Link>
            {active && <WriteOnly><Link href={`/leads/${a.leadId}/visit?appointment=${a.id}&returnTo=${encodeURIComponent(`/appointments/${a.id}`)}`} className="btn-primary">Record visit</Link></WriteOnly>}
          </>
        }
      />
      <Flash message={msg} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title="Details">
            <dl className="grid gap-4 p-4 sm:grid-cols-2">
              <KV label="When">{a.timeSet ? <>{apptRange(a, tz)} ({minutes} min)</> : <>{apptRange(a, tz)} — set a time with “Move” below</>}</KV>
              <KV label="Type">{a.kind === "FOLLOW_UP_VISIT" ? "Follow-up visit" : "Appointment"}</KV>
              <KV label="Location">{a.location}</KV>
              <KV label="Rep">{a.rep.name}</KV>
              <KV label="Booked by">{a.createdBy.name} · {fmtDateTime(a.createdAt, tz)}</KV>
              {original && original.toStart && original.toStart.getTime() !== a.startAt.getTime() && <KV label="Originally booked for">{fmtDateTime(original.toStart, tz)}</KV>}
              {a.cancelReason && <KV label="Cancel reason">{a.cancelReason}</KV>}
              {a.notes && <KV label="Notes" className="sm:col-span-2"><span className="whitespace-pre-line">{a.notes}</span></KV>}
            </dl>
            {a.visitsFrom.length > 0 && <p className="border-t border-line px-4 py-2 text-sm">Visit recorded: <Link className="link" href={`/leads/${a.leadId}?tab=visits`}>{fmtDateTime(a.visitsFrom[0].visitAt, tz)}</Link></p>}
          </Section>

          <Section title="History" subtitle="Every booking, move, cancellation and status change — nothing is overwritten.">
            <ol className="divide-y divide-line-2">
              {a.changes.map((c) => (
                <li key={c.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={c.action === "CANCELED" ? "muted" : c.action === "MOVED" ? "warn" : c.action === "COMPLETED" ? "good" : "neutral"}>{CHANGE_LABEL[c.action]}</Badge><span className="text-xs text-muted">{fmtDateTime(c.createdAt, tz)} · {c.changedBy.name}</span></div>
                  {c.action === "MOVED" && <div className="mt-1">From {fmtDateTime(c.fromStart, tz)} to <strong>{fmtDateTime(c.toStart, tz)}</strong></div>}
                  {c.action === "CREATED" && c.toStart && <div className="mt-1">For {fmtDateTime(c.toStart, tz)}</div>}
                  {c.reason && <div className="text-ink-2">{c.reason}</div>}
                </li>
              ))}
            </ol>
          </Section>

          {a.reschedules.length > 0 && (
            <Section title="Reschedule requests">
              <ul className="divide-y divide-line-2">
                {a.reschedules.map((r) => (
                  <li key={r.id} className="px-4 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><RescheduleBadge s={r.status} /><span className="text-xs text-muted">{r.requestedBy.name} · {fmtDateTime(r.createdAt, tz)}</span></div>
                    <div className="mt-1">{fmtDateTime(r.originalStart, tz)} → {fmtDateTime(r.requestedStart, tz)}{r.finalStart && r.finalStart.getTime() !== r.requestedStart.getTime() ? ` (approved for ${fmtDateTime(r.finalStart, tz)})` : ""}</div>
                    <div className="text-ink-2">Reason: {r.reason}</div>
                    {r.resolutionNotes && <div className="text-xs text-muted">{r.resolvedBy?.name}: {r.resolutionNotes}</div>}
                    {r.status === "PENDING" && (r.requestedById === actor.id || isCoord) && (
                      <ActionForm action={cancelRescheduleAction} className="mt-1"><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn-ghost btn-sm">Withdraw request</SubmitButton></ActionForm>
                    )}
                    {r.status === "PENDING" && isCoord && <Link href={`/reschedules#${r.id}`} className="link text-xs">Review on Reschedules page</Link>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-5">
          {active && (
            <Section title="Status">
              <div className="flex flex-wrap gap-2 p-4">
                {a.status === "SCHEDULED" && <ActionForm action={appointmentStatusAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="CONFIRMED" /><SubmitButton className="btn-secondary">Mark confirmed</SubmitButton></ActionForm>}
                <ActionForm action={appointmentStatusAction} confirm="Mark this appointment as a no-show?"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="NO_SHOW" /><SubmitButton className="btn-secondary">No-show</SubmitButton></ActionForm>
              </div>
            </Section>
          )}

          {active && isCoord && (
            <Section title="Reschedule">
              <ActionForm action={moveAppointmentAction} className="grid gap-2 p-4">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="version" value={a.version} />
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="label">New date</span><input type="date" name="date" required defaultValue={dateKeyInTz(a.startAt, tz)} className="input" /></label>
                  <label className="block"><span className="label">Time</span><input type="time" name="time" required defaultValue={timeInTz(a.startAt, tz)} className="input" /></label>
                </div>
                <label className="block"><span className="label">Length (min)</span><input type="number" name="minutes" min={5} max={720} defaultValue={minutes} className="input" /></label>
                <label className="block"><span className="label">Reason</span><input name="reason" className="input" placeholder="e.g. Owner asked for the afternoon" /></label>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="allowOverlap" /> Book anyway if it overlaps</label>
                <SubmitButton className="btn-secondary">Move appointment</SubmitButton>
              </ActionForm>
            </Section>
          )}

          {active && !isCoord && !pending && (
            <Section title="Request a new time" subtitle="The appointment stays as-is until the coordinator approves.">
              <ActionForm action={requestRescheduleAction} className="grid gap-2 p-4">
                <input type="hidden" name="id" value={a.id} />
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="label">Date</span><input type="date" name="date" required defaultValue={dateKeyInTz(a.startAt, tz)} className="input" /></label>
                  <label className="block"><span className="label">Time</span><input type="time" name="time" required defaultValue={timeInTz(a.startAt, tz)} className="input" /></label>
                </div>
                <label className="block"><span className="label">Length (min)</span><input type="number" name="minutes" min={5} max={720} defaultValue={minutes} className="input" /></label>
                <label className="block"><span className="label">Reason <span className="text-red-600">*</span></span><textarea name="reason" required minLength={3} rows={2} className="input" placeholder="Why does it need to change?" /></label>
                <SubmitButton>Send request</SubmitButton>
              </ActionForm>
            </Section>
          )}

          {active && isCoord && (
            <Section title="Cancel appointment">
              <ActionForm action={appointmentStatusAction} className="grid gap-2 p-4" confirm="Cancel this appointment? It stays in the history and on the lead's record.">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="status" value="CANCELED" />
                <label className="block"><span className="label">Reason <span className="text-red-600">*</span></span><input name="reason" required className="input" /></label>
                <SubmitButton className="btn-danger">Cancel appointment</SubmitButton>
              </ActionForm>
            </Section>
          )}

          {a.status === "CANCELED" && isCoord && (
            <Section title="Restore">
              <ActionForm action={appointmentStatusAction} className="p-4"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="SCHEDULED" /><SubmitButton className="btn-secondary">Restore appointment</SubmitButton></ActionForm>
            </Section>
          )}

          <Section title="Edit details">
            <ActionForm action={appointmentDetailsAction} className="grid gap-2 p-4">
              <input type="hidden" name="id" value={a.id} />
              <label className="block"><span className="label">Type</span><select name="kind" defaultValue={a.kind} className="input"><option value="APPOINTMENT">Appointment</option><option value="FOLLOW_UP_VISIT">Follow-up visit</option></select></label>
              <label className="block"><span className="label">Location</span><input name="location" defaultValue={a.location ?? ""} className="input" /></label>
              <label className="block"><span className="label">Notes</span><textarea name="notes" rows={3} defaultValue={a.notes ?? ""} className="input" /></label>
              <SubmitButton className="btn-secondary">Save</SubmitButton>
            </ActionForm>
          </Section>
          {a.changes.length === 0 && <Empty>No history.</Empty>}
        </div>
      </div>
    </div>
  );
}
