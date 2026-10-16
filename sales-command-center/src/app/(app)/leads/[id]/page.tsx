import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { can, assertLeadAccess } from "@/server/policy";
import { AppError } from "@/server/errors";
import { repOptions } from "@/server/options";
import { Badge, DemoBadge, Empty, Flash, KV, PageHeader, Section, Tabs } from "@/components/ui";
import { ApptStatusBadge, DueBadge, LeadStatusBadge, OppStatusBadge, OutcomeBadge, PriorityBadge, RescheduleBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { setStatusAction, archiveLeadAction, assignLeadAction } from "@/app/actions/leads";
import { createFollowUpAction, followUpStatusAction } from "@/app/actions/followups";
import { CLOSED_STATUSES, INTEREST_LABEL, LEAD_STATUSES, LEAD_STATUS_LABEL, VISIT_TYPE_LABEL, money } from "@/lib/labels";
import { formatPhone } from "@/lib/normalize";
import { addDays, dateKeyInTz, fmtDate, fmtDateTime, fmtTime, relativeDay, apptRange, apptDateTime } from "@/lib/time";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "contact", label: "Contact" },
  { key: "visits", label: "Visit History" },
  { key: "notes", label: "Notes & Feedback" },
  { key: "appointments", label: "Appointments" },
  { key: "sales", label: "Opportunities & Sales" },
  { key: "activity", label: "Activity" },
];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await prisma.lead.findUnique({ where: { id }, select: { businessName: true } });
  return { title: l?.businessName ?? "Lead" };
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; msg?: string }> }) {
  const { id } = await params;
  const { tab: tabParam, msg } = await searchParams;
  const actor = await requireActor();
  const settings = await getSettings();
  const tz = settings.timezone;
  const now = new Date();
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      territory: true,
      area: true,
      assignedRep: { select: { id: true, name: true, phone: true } },
      visits: { orderBy: { visitAt: "desc" }, include: { rep: { select: { name: true } }, nextAppointment: true } },
      appointments: { orderBy: { startAt: "desc" }, include: { rep: { select: { name: true } }, changes: { orderBy: { createdAt: "asc" }, include: { changedBy: { select: { name: true } } } }, reschedules: { orderBy: { createdAt: "desc" } } } },
      followUps: { orderBy: [{ status: "asc" }, { dueAt: "asc" }], include: { assignedTo: { select: { name: true } } } },
      opportunities: { where: { archivedAt: null }, orderBy: { openedAt: "desc" }, include: { rep: { select: { name: true } } } },
      stops: { where: { status: "PLANNED" }, include: { dayPlan: true } },
    },
  });
  if (!lead) notFound();
  try {
    assertLeadAccess(actor, lead);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const isCoord = can(actor, "lead.editAll");
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam! : "overview";
  const reps = isCoord ? await repOptions() : [];
  const timeline = tab === "activity" || tab === "overview" ? await prisma.auditLog.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" }, take: tab === "activity" ? 300 : 8, include: { actor: { select: { name: true } } } }) : [];
  const openFollowUps = lead.followUps.filter((f) => f.status === "OPEN");
  const upcomingAppts = lead.appointments.filter((a) => (a.status === "SCHEDULED" || a.status === "CONFIRMED") && a.endAt >= now).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const plannedStops = lead.stops.filter((s) => s.dayPlan.date >= dateKeyInTz(now, tz)).sort((a, b) => a.dayPlan.date.localeCompare(b.dayPlan.date));
  const closed = CLOSED_STATUSES.includes(lead.status);
  const mapQuery = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
  const tomorrow = addDays(dateKeyInTz(now, tz), 1);

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: "/leads", label: "Leads" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {lead.businessName}
            <span className="text-sm font-normal text-muted">#{lead.leadNumber}</span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <LeadStatusBadge s={lead.status} />
            <PriorityBadge p={lead.priority} />
            {lead.archivedAt && <Badge tone="muted">Archived</Badge>}
            <DemoBadge show={lead.isDemo} />
            <span>{[lead.area?.name, lead.territory?.name].filter(Boolean).join(" · ") || "No area"}</span>
            <span>· {lead.assignedRep ? `Rep: ${lead.assignedRep.name}` : "Unassigned"}</span>
          </span>
        }
        actions={
          <>
            {!lead.archivedAt && <Link href={`/leads/${lead.id}/visit`} className="btn-primary">Record visit</Link>}
            {!lead.archivedAt && lead.status !== "DO_NOT_CONTACT" && <Link href={`/appointments/new?lead=${lead.id}`} className="btn-secondary">Schedule appointment</Link>}
            {!lead.archivedAt && <Link href={`/sales/new?lead=${lead.id}`} className="btn-secondary">New opportunity</Link>}
            <Link href={`/leads/${lead.id}/edit`} className="btn-secondary">Edit</Link>
          </>
        }
      />
      <Flash message={msg} />
      {lead.status === "DO_NOT_CONTACT" && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Do Not Contact — new appointments, follow-ups and planned visits are blocked. History is kept below.
        </div>
      )}

      {/* quick contact row (big tap targets for phones) */}
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        {lead.phone && <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="btn-secondary">📞 Call</a>}
        {lead.email && <a href={`mailto:${lead.email}`} className="btn-secondary">✉ Email</a>}
        {mapQuery && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">⌖ Map</a>}
      </div>

      <Tabs active={tab} tabs={TABS.map((t) => ({ ...t, href: `/leads/${lead.id}?tab=${t.key}`, label: t.key === "visits" ? `${t.label} (${lead.visits.length})` : t.label }))} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Section title="Summary">
              <dl className="grid grid-cols-2 gap-4 p-4 md:grid-cols-3">
                <KV label="Last visited">{lead.lastVisitAt ? `${fmtDate(lead.lastVisitAt, tz)} (${relativeDay(lead.lastVisitAt, tz, now)})` : <Badge tone="warn">Never visited</Badge>}</KV>
                <KV label="Last outcome">{lead.lastVisitOutcome ? <OutcomeBadge o={lead.lastVisitOutcome} /> : "—"}</KV>
                <KV label="Last contact">{lead.lastContactAt ? fmtDate(lead.lastContactAt, tz) : "—"}</KV>
                <KV label="Visits recorded">{lead.visitCount} in person{lead.visits.length > lead.visitCount ? ` + ${lead.visits.length - lead.visitCount} call(s)` : ""}</KV>
                <KV label="Next follow-up">{lead.nextFollowUpAt ? <span className="inline-flex items-center gap-1">{fmtDate(lead.nextFollowUpAt, tz)} <DueBadge due={lead.nextFollowUpAt} now={now} tz={tz} /></span> : "—"}</KV>
                <KV label="Next appointment">{(() => { const n = lead.appointments.find((a) => a.startAt.getTime() === lead.nextAppointmentAt?.getTime()); return n ? apptDateTime(n, tz) : lead.nextAppointmentAt ? fmtDateTime(lead.nextAppointmentAt, tz) : "—"; })()}</KV>
                <KV label="Next planned visit">{plannedStops[0] ? fmtDate(new Date(plannedStops[0].dayPlan.date + "T12:00:00Z"), "UTC") : "—"}</KV>
                <KV label="Estimated value">{money(lead.estimatedValue ? Number(lead.estimatedValue) : null)}</KV>
                <KV label="Created">{fmtDate(lead.createdAt, tz)}{lead.source ? ` · ${lead.source}` : ""}</KV>
              </dl>
              {lead.latestFeedback && (
                <div className="border-t border-line px-4 py-3">
                  <div className="text-xs text-muted">Latest rep feedback</div>
                  <p className="mt-1 whitespace-pre-line text-sm">{lead.latestFeedback}</p>
                </div>
              )}
            </Section>

            <Section title="Follow-ups" subtitle={`${openFollowUps.length} open`}>
              {openFollowUps.length > 0 && (
                <ul className="divide-y divide-line-2">
                  {openFollowUps.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm">{f.action}</div>
                        <div className="flex items-center gap-1.5 text-xs text-muted">{fmtDate(f.dueAt, tz)} <DueBadge due={f.dueAt} now={now} tz={tz} /> · {f.assignedTo.name}</div>
                      </div>
                      <div className="flex gap-1">
                        <ActionForm action={followUpStatusAction}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value="DONE" /><SubmitButton className="btn-secondary btn-sm">Done</SubmitButton></ActionForm>
                        <ActionForm action={followUpStatusAction} confirm="Cancel this follow-up?"><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value="CANCELED" /><SubmitButton className="btn-ghost btn-sm">Cancel</SubmitButton></ActionForm>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!closed || lead.status === "WON" ? (
                <ActionForm action={createFollowUpAction} className="grid gap-2 border-t border-line p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end" resetOnSuccess>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <label className="block"><span className="label">New follow-up</span><input name="action" className="input" placeholder="e.g. Call owner back with pricing" required maxLength={500} /></label>
                  <label className="block"><span className="label">Due</span><input type="date" name="dueDate" className="input" defaultValue={tomorrow} required /></label>
                  <label className="block"><span className="label">Time</span><input type="time" name="dueTime" className="input" defaultValue="09:00" /></label>
                  <SubmitButton className="btn-secondary">Add</SubmitButton>
                </ActionForm>
              ) : (
                <p className="border-t border-line px-4 py-3 text-xs text-muted">Lead is {LEAD_STATUS_LABEL[lead.status]} — no new follow-ups.</p>
              )}
            </Section>

            <Section title="Recent activity" action={<Link href={`/leads/${lead.id}?tab=activity`} className="link text-xs">Full timeline</Link>}>
              <Timeline items={timeline} tz={tz} />
            </Section>
          </div>

          <div className="space-y-5">
            <Section title="Status">
              <ActionForm action={setStatusAction} className="flex gap-2 p-4" confirm={undefined}>
                <input type="hidden" name="id" value={lead.id} />
                <select name="status" defaultValue={lead.status} className="input" aria-label="Lead status">
                  {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
                </select>
                <SubmitButton className="btn-secondary" confirm="Change this lead's status? Marking Lost, Not a Fit or Do Not Contact cancels open follow-ups and planned visits (history is kept).">Update</SubmitButton>
              </ActionForm>
            </Section>
            <Section title="Upcoming">
              {upcomingAppts.length === 0 && plannedStops.length === 0 ? (
                <Empty>Nothing scheduled.</Empty>
              ) : (
                <ul className="divide-y divide-line-2 text-sm">
                  {upcomingAppts.map((a) => (
                    <li key={a.id} className="px-4 py-2.5">
                      <Link href={`/appointments/${a.id}`} className="font-medium hover:underline">{a.kind === "FOLLOW_UP_VISIT" ? "Follow-up visit" : "Appointment"}</Link>
                      <div className="text-xs text-muted">{apptRange(a, tz)} · {a.rep.name}</div>
                    </li>
                  ))}
                  {plannedStops.map((s) => (
                    <li key={s.id} className="px-4 py-2.5">
                      <Link href={`/schedule?date=${s.dayPlan.date}`} className="font-medium hover:underline">Planned visit</Link>
                      <div className="text-xs text-muted">{fmtDate(new Date(s.dayPlan.date + "T12:00:00Z"), "UTC", { weekday: "short", month: "short", day: "numeric" })}{s.dayPlan.label ? ` · ${s.dayPlan.label}` : ""}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            {isCoord && (
              <Section title="Assignment">
                <ActionForm action={assignLeadAction} className="flex gap-2 p-4">
                  <input type="hidden" name="id" value={lead.id} />
                  <select name="repId" defaultValue={lead.assignedRepId ?? ""} className="input" aria-label="Assigned rep">
                    <option value="">Unassigned</option>
                    {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <SubmitButton className="btn-secondary">Assign</SubmitButton>
                </ActionForm>
              </Section>
            )}
            {lead.tags.length > 0 && (
              <Section title="Tags">
                <div className="flex flex-wrap gap-1.5 p-4">{lead.tags.map((t) => <Link key={t} href={`/leads?tag=${encodeURIComponent(t)}`} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink-2 ring-1 ring-line">{t}</Link>)}</div>
              </Section>
            )}
            {isCoord && (
              <ActionForm action={archiveLeadAction} confirm={lead.archivedAt ? undefined : "Archive this lead? It leaves active lists, but all visits, appointments and sales are kept. You can restore it any time."}>
                <input type="hidden" name="id" value={lead.id} />
                <input type="hidden" name="archive" value={lead.archivedAt ? "false" : "true"} />
                <SubmitButton className={lead.archivedAt ? "btn-secondary w-full" : "btn-danger w-full"}>{lead.archivedAt ? "Restore lead" : "Archive lead"}</SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
      )}

      {tab === "contact" && (
        <Section title="Contact information" action={<Link href={`/leads/${lead.id}/edit`} className="link text-xs">Edit</Link>}>
          <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <KV label="Contact person">{lead.contactName}</KV>
            <KV label="Job title">{lead.jobTitle}</KV>
            <KV label="Phone">{lead.phone ? <a className="link" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>{formatPhone(lead.phone)}</a> : null}</KV>
            <KV label="Email">{lead.email ? <a className="link" href={`mailto:${lead.email}`}>{lead.email}</a> : null}</KV>
            <KV label="Address">{mapQuery ? <a className="link" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}>{mapQuery}</a> : null}</KV>
            <KV label="Area / territory">{[lead.area?.name, lead.territory?.name].filter(Boolean).join(" · ") || null}</KV>
            <KV label="Industry">{lead.industry}</KV>
            <KV label="Lead source">{lead.source}</KV>
            <KV label="Prospect / account #">{lead.externalId}</KV>
            <KV label="Employees">{lead.employeeCount != null ? lead.employeeCount.toLocaleString() : null}</KV>
            <KV label="Assigned rep">{lead.assignedRep?.name ?? "Unassigned"}</KV>
            <KV label="Created">{fmtDateTime(lead.createdAt, tz)}</KV>
            <KV label="Last updated">{fmtDateTime(lead.updatedAt, tz)}</KV>
          </dl>
          {lead.sourceDetails && typeof lead.sourceDetails === "object" && Object.keys(lead.sourceDetails).length > 0 && (
            <div className="border-t border-line px-4 py-3">
              <div className="mb-2 text-xs font-medium text-muted">Details from import — other columns of the imported file, exactly as written</div>
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
                {Object.entries(lead.sourceDetails as Record<string, string>).map(([k, v]) => <div key={k} className="min-w-0"><dt className="truncate text-xs text-muted">{k}</dt><dd className="truncate">{String(v)}</dd></div>)}
              </dl>
            </div>
          )}
        </Section>
      )}

      {tab === "visits" && (
        <Section title="Visit history" subtitle="Every visit is kept permanently — newer visits never overwrite older ones." action={!lead.archivedAt ? <Link href={`/leads/${lead.id}/visit`} className="btn-primary btn-sm">Record visit</Link> : undefined}>
          {lead.visits.length === 0 ? <Empty>No visits recorded yet.</Empty> : (
            <ol className="divide-y divide-line-2">
              {lead.visits.map((v) => (
                <li key={v.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{fmtDateTime(v.visitAt, tz)}</span>
                    <Badge tone="neutral">{VISIT_TYPE_LABEL[v.type]}</Badge>
                    <OutcomeBadge o={v.outcome} />
                    {v.interestLevel && <Badge tone={v.interestLevel === "HIGH" ? "good" : v.interestLevel === "MEDIUM" ? "info" : "muted"}>Interest: {INTEREST_LABEL[v.interestLevel]}</Badge>}
                    <span className="text-xs text-muted">by {v.rep.name}</span>
                  </div>
                  <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    {v.contactEncountered && <KV label="Spoke with">{v.contactEncountered}</KV>}
                    {v.feedback && <KV label="Feedback" className="sm:col-span-2"><span className="whitespace-pre-line">{v.feedback}</span></KV>}
                    {v.objections && <KV label="Objections / reasons" className="sm:col-span-2"><span className="whitespace-pre-line">{v.objections}</span></KV>}
                    {v.followUpAction && <KV label="Follow-up">{v.followUpAction}{v.followUpDueAt ? ` — due ${fmtDate(v.followUpDueAt, tz)}` : ""}</KV>}
                    {v.nextAppointment && <KV label="Next appointment"><Link className="link" href={`/appointments/${v.nextAppointment.id}`}>{apptDateTime(v.nextAppointment, tz)}</Link></KV>}
                    {v.notes && <KV label="Notes" className="sm:col-span-2"><span className="whitespace-pre-line">{v.notes}</span></KV>}
                    {v.attachmentName && <KV label="Attachment"><a className="link" href={`/api/files/visit/${v.id}`}>{v.attachmentName}</a></KV>}
                  </dl>
                  <div className="mt-1 text-[11px] text-muted">Recorded {fmtDateTime(v.createdAt, tz)}</div>
                </li>
              ))}
            </ol>
          )}
        </Section>
      )}

      {tab === "notes" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Coordinator notes" action={isCoord ? <Link href={`/leads/${lead.id}/edit`} className="link text-xs">Edit</Link> : undefined}>
            <div className="whitespace-pre-line p-4 text-sm">{lead.notes || <span className="text-muted">No notes.</span>}</div>
          </Section>
          <Section title="Rep feedback" subtitle="From every visit, newest first">
            {lead.visits.filter((v) => v.feedback || v.objections).length === 0 ? <Empty>No feedback yet.</Empty> : (
              <ul className="divide-y divide-line-2">
                {lead.visits.filter((v) => v.feedback || v.objections).map((v) => (
                  <li key={v.id} className="px-4 py-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted">{fmtDate(v.visitAt, tz)} · {v.rep.name} <OutcomeBadge o={v.outcome} /></div>
                    {v.feedback && <p className="whitespace-pre-line">{v.feedback}</p>}
                    {v.objections && <p className="mt-1 whitespace-pre-line text-ink-2"><span className="text-xs text-muted">Objections: </span>{v.objections}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      {tab === "appointments" && (
        <Section title="Appointments" subtitle="Including canceled and rescheduled ones — nothing is deleted." action={lead.status !== "DO_NOT_CONTACT" && !lead.archivedAt ? <Link href={`/appointments/new?lead=${lead.id}`} className="btn-primary btn-sm">Schedule</Link> : undefined}>
          {lead.appointments.length === 0 ? <Empty>No appointments.</Empty> : (
            <ul className="divide-y divide-line-2">
              {lead.appointments.map((a) => {
                const moves = a.changes.filter((c) => c.action === "MOVED");
                return (
                  <li key={a.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/appointments/${a.id}`} className="font-medium hover:underline">{apptRange(a, tz)}</Link>
                      <ApptStatusBadge s={a.status} />
                      {moves.length > 0 && <Badge tone="warn">Rescheduled {moves.length}×</Badge>}
                      {a.reschedules.some((r) => r.status === "PENDING") && <RescheduleBadge s="PENDING" />}
                      <span className="text-xs text-muted">{a.kind === "FOLLOW_UP_VISIT" ? "Follow-up visit" : "Appointment"} · {a.rep.name}</span>
                    </div>
                    {a.cancelReason && <p className="mt-1 text-xs text-ink-2">Canceled: {a.cancelReason}</p>}
                    {moves.length > 0 && (
                      <ul className="mt-1 text-xs text-muted">
                        {moves.map((c) => <li key={c.id}>Moved from {fmtDateTime(c.fromStart, tz)} to {fmtDateTime(c.toStart, tz)}{c.reason ? ` — ${c.reason}` : ""} ({c.changedBy.name})</li>)}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}

      {tab === "sales" && (
        <Section title="Opportunities & sales" action={!lead.archivedAt ? <Link href={`/sales/new?lead=${lead.id}`} className="btn-primary btn-sm">New opportunity</Link> : undefined}>
          {lead.opportunities.length === 0 ? <Empty>No opportunities yet.</Empty> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>#</th><th>Product / service</th><th>Status</th><th>Estimated</th><th>Final amount</th><th>Opened</th><th>Closed</th><th>Rep</th></tr></thead>
                <tbody>
                  {lead.opportunities.map((o) => (
                    <tr key={o.id}>
                      <td><Link className="link" href={`/sales/${o.id}`}>O-{o.oppNumber}</Link></td>
                      <td>{o.product}</td>
                      <td><OppStatusBadge s={o.status} /></td>
                      <td>{money(o.estimatedValue ? Number(o.estimatedValue) : null)}</td>
                      <td>{o.status === "WON" ? money(o.finalAmount ? Number(o.finalAmount) : null) : "—"}</td>
                      <td>{fmtDate(o.openedAt, tz)}</td>
                      <td>{o.closedAt ? fmtDate(o.closedAt, tz) : "—"}</td>
                      <td>{o.rep.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {tab === "activity" && (
        <Section title="Activity timeline" subtitle="Creation, assignments, calls, visits, appointments, reschedules, feedback, status changes and sales — oldest at the bottom.">
          <Timeline items={timeline} tz={tz} />
        </Section>
      )}
    </div>
  );
}

function Timeline({ items, tz }: { items: { id: string; action: string; summary: string; createdAt: Date; actor: { name: string } | null }[]; tz: string }) {
  if (items.length === 0) return <Empty>No activity yet.</Empty>;
  const icon = (a: string) =>
    a.startsWith("visit") ? "✎" : a.startsWith("appointment") ? "◷" : a.startsWith("reschedule") ? "⇄" : a.startsWith("opportunity") || a.startsWith("sale") ? "$" : a.startsWith("followup") ? "↻" : a === "lead.status" ? "◆" : a === "lead.assigned" ? "→" : "•";
  return (
    <ol className="relative px-4 py-3">
      {items.map((e) => (
        <li key={e.id} className="relative flex gap-3 pb-3 last:pb-0">
          <span aria-hidden className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-canvas text-xs ring-1 ring-line">{icon(e.action)}</span>
          <div className="min-w-0">
            <div className="text-sm">{e.summary}</div>
            <div className="text-xs text-muted">{fmtDateTime(e.createdAt, tz)}{e.actor ? ` · ${e.actor.name}` : ""}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
