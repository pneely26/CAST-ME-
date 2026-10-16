import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { sp, type SP } from "@/server/services/leadQuery";
import { repOptions } from "@/server/options";
import { Empty, Flash, PageHeader, Section } from "@/components/ui";
import { DueBadge, LeadStatusBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { followUpStatusAction, moveFollowUpAction } from "@/app/actions/followups";
import { addDays, dateKeyInTz, dayRangeUtc, fmtDate, fmtTime } from "@/lib/time";

export const metadata = { title: "Follow-ups" };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  const tz = (await getSettings()).timezone;
  const now = new Date();
  const today = dateKeyInTz(now, tz);
  const { start: todayStart, end: todayEnd } = dayRangeUtc(today, today, tz);
  const isCoord = actor.role === "COORDINATOR";
  const due = sp(params, "due") ?? "open";
  const rep = isCoord ? sp(params, "rep") : actor.id;
  const where: Prisma.FollowUpWhereInput = { lead: { archivedAt: null }, ...(rep ? { assignedToId: rep } : {}) };
  if (due === "done") Object.assign(where, { status: { in: ["DONE", "CANCELED"] } });
  else {
    Object.assign(where, { status: "OPEN" });
    if (due === "overdue") Object.assign(where, { dueAt: { lt: todayStart } });
    if (due === "today") Object.assign(where, { dueAt: { lt: todayEnd } });
    if (due === "week") Object.assign(where, { dueAt: { lt: dayRangeUtc(addDays(today, 7), addDays(today, 7), tz).end } });
  }
  const [items, reps] = await Promise.all([
    prisma.followUp.findMany({ where, include: { lead: { select: { id: true, businessName: true, status: true, phone: true } }, assignedTo: { select: { name: true } } }, orderBy: due === "done" ? { completedAt: "desc" } : { dueAt: "asc" }, take: 300 }),
    isCoord ? repOptions() : Promise.resolve([]),
  ]);
  const tabs: [string, string][] = [["open", "All open"], ["overdue", "Overdue"], ["today", "Due today"], ["week", "Next 7 days"], ["done", "Completed"]];
  const groups = due === "done" ? [{ title: "Completed & canceled", items }] : [
    { title: "Overdue", items: items.filter((f) => f.dueAt < todayStart) },
    { title: "Due today", items: items.filter((f) => f.dueAt >= todayStart && f.dueAt < todayEnd) },
    { title: "Upcoming", items: items.filter((f) => f.dueAt >= todayEnd) },
  ].filter((g) => g.items.length);

  return (
    <div className="space-y-4">
      <PageHeader title="Follow-ups" subtitle="Created from visit feedback or added on a lead." />
      <Flash message={sp(params, "msg")} />
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(([k, l]) => <Link key={k} href={`/follow-ups?due=${k}${rep && isCoord ? `&rep=${rep}` : ""}`} className={due === k ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{l}</Link>)}
        {isCoord && (
          <form method="get" className="ml-auto flex items-center gap-1">
            <input type="hidden" name="due" value={due} />
            <select name="rep" defaultValue={rep ?? ""} className="input py-1" aria-label="Rep"><option value="">Everyone</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            <button className="btn-secondary btn-sm">Filter</button>
          </form>
        )}
      </div>
      {groups.length === 0 && <div className="card"><Empty>Nothing here.</Empty></div>}
      {groups.map((g) => (
        <Section key={g.title} title={`${g.title} (${g.items.length})`}>
          <ul className="divide-y divide-line-2">
            {g.items.map((f) => (
              <li key={f.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><Link href={`/leads/${f.lead.id}`} className="font-medium hover:underline">{f.lead.businessName}</Link><LeadStatusBadge s={f.lead.status} /><DueBadge due={f.dueAt} now={now} tz={tz} done={f.status !== "OPEN"} /></div>
                  <div className="text-sm">{f.action}</div>
                  <div className="text-xs text-muted">Due {fmtDate(f.dueAt, tz)} {fmtTime(f.dueAt, tz)}{isCoord ? ` · ${f.assignedTo.name}` : ""}{f.completedAt ? ` · ${f.status === "DONE" ? "done" : "canceled"} ${fmtDate(f.completedAt, tz)}` : ""}</div>
                </div>
                {f.status === "OPEN" ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {f.lead.phone && <a href={`tel:${f.lead.phone.replace(/[^\d+]/g, "")}`} className="btn-secondary btn-sm">Call</a>}
                    <Link href={`/leads/${f.lead.id}/visit?type=PHONE_CALL&returnTo=/follow-ups`} className="btn-secondary btn-sm">Log contact</Link>
                    <ActionForm action={followUpStatusAction}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value="DONE" /><SubmitButton className="btn-primary btn-sm">Done</SubmitButton></ActionForm>
                    <ActionForm action={moveFollowUpAction} className="flex items-center gap-1"><input type="hidden" name="id" value={f.id} /><input type="date" name="dueDate" defaultValue={addDays(today, 1)} className="input w-[140px] py-1" aria-label="New due date" /><SubmitButton className="btn-ghost btn-sm">Move</SubmitButton></ActionForm>
                    <ActionForm action={followUpStatusAction} confirm="Cancel this follow-up?"><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value="CANCELED" /><SubmitButton className="btn-ghost btn-sm">Cancel</SubmitButton></ActionForm>
                  </div>
                ) : (
                  <ActionForm action={followUpStatusAction}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value="OPEN" /><SubmitButton className="btn-ghost btn-sm">Reopen</SubmitButton></ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}
