import Link from "next/link";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { BUILT_IN_VIEWS, SORTS, listLeads, sp, type SP } from "@/server/services/leadQuery";
import { territoryOptions } from "@/server/services/territories";
import { repOptions, areaOptions } from "@/server/options";
import { can } from "@/server/policy";
import { Empty, Flash, PageHeader } from "@/components/ui";
import { LeadTable } from "@/components/LeadTable";
import { LeadStatusBadge, PriorityBadge, DueBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { saveViewAction, deleteViewAction } from "@/app/actions/leads";
import { LEAD_STATUSES, LEAD_STATUS_LABEL, PRIORITIES, PRIORITY_LABEL } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/time";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  const settings = await getSettings();
  const tz = settings.timezone;
  const isCoord = can(actor, "lead.editAll");
  const [{ total, rows, page, pageSize, sortKey }, territories, reps, areas, saved] = await Promise.all([
    listLeads(actor, params, settings),
    territoryOptions(),
    repOptions(),
    areaOptions(),
    prisma.savedView.findMany({ where: { userId: actor.id }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  const view = sp(params, "view") ?? "all";
  const qs = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" && v && k !== "page" && k !== "msg" ? [[k, v]] : [])));
  const currentQuery = qs.toString();
  const pageHref = (p: number) => `/leads?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(p) })}`;
  const views = BUILT_IN_VIEWS.filter((v) => (!v.coordinatorOnly || isCoord) && !(v.key === "mine" && !isCoord));
  const viewLabel = (k: string, l: string) => (k === "stale" ? `Not Visited in ${settings.staleVisitDays}+ Days` : k === "all" && !isCoord ? "My Assigned Leads" : l);
  const filterVal = (k: string) => sp(params, k) ?? "";

  return (
    <div>
      <PageHeader
        title={isCoord ? "Leads" : "My Leads"}
        subtitle={`${total} lead${total === 1 ? "" : "s"}${view !== "all" ? ` · ${viewLabel(view, BUILT_IN_VIEWS.find((v) => v.key === view)?.label ?? "")}` : ""}`}
        actions={
          <>
            <a className="btn-secondary" href={`/api/export/leads?${currentQuery}`}>Export CSV</a>
            {isCoord && <Link href="/import" className="btn-secondary">Import</Link>}
            {isCoord && <Link href="/leads/new" className="btn-primary">New lead</Link>}
          </>
        }
      />
      <Flash message={sp(params, "msg")} />

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {views.map((v) => (
          <Link key={v.key} href={`/leads${v.query ? `?${v.query}` : ""}`} className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${view === v.key ? "border-accent bg-accent text-white" : "border-line bg-white text-ink-2 hover:bg-canvas"}`}>
            {viewLabel(v.key, v.label)}
          </Link>
        ))}
        {saved.map((v) => (
          <Link key={v.id} href={`/leads?${v.query}`} className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${currentQuery === v.query ? "border-accent bg-accent text-white" : "border-dashed border-accent/40 bg-white text-accent"}`}>★ {v.name}</Link>
        ))}
      </div>

      <form method="get" className="card mb-4 grid grid-cols-2 gap-3 p-3 md:grid-cols-4 xl:grid-cols-8">
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        <label className="col-span-2 block"><span className="label">Search</span><input name="q" defaultValue={filterVal("q")} className="input" placeholder="Company, contact, phone, email, address, notes" /></label>
        <label className="block"><span className="label">Territory</span>
          <select name="territory" defaultValue={filterVal("territory")} className="input"><option value="">Any</option><option value="none">None</option>{territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </label>
        <label className="block"><span className="label">Area</span>
          <select name="area" defaultValue={filterVal("area")} className="input"><option value="">Any</option><option value="none">None</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
        </label>
        <label className="block"><span className="label">Status</span>
          <select name="status" defaultValue={filterVal("status")} className="input"><option value="">Any</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}</select>
        </label>
        <label className="block"><span className="label">Priority</span>
          <select name="priority" defaultValue={filterVal("priority")} className="input"><option value="">Any</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
        </label>
        {isCoord && (
          <label className="block"><span className="label">Rep</span>
            <select name="rep" defaultValue={filterVal("rep")} className="input"><option value="">Any</option><option value="none">Unassigned</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
        )}
        <label className="block"><span className="label">Last visited</span>
          <select name="visited" defaultValue={filterVal("visited")} className="input"><option value="">Any time</option><option value="never">Never visited</option><option value="stale">{settings.staleVisitDays}+ days ago</option></select>
        </label>
        <label className="block"><span className="label">Visited from</span><input type="date" name="visitedFrom" defaultValue={filterVal("visitedFrom")} className="input" /></label>
        <label className="block"><span className="label">Visited to</span><input type="date" name="visitedTo" defaultValue={filterVal("visitedTo")} className="input" /></label>
        <label className="block"><span className="label">Follow-up</span>
          <select name="followUp" defaultValue={filterVal("followUp")} className="input"><option value="">Any</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Due within 7 days</option><option value="none">None set</option></select>
        </label>
        <label className="block"><span className="label">Sort</span>
          <select name="sort" defaultValue={sortKey} className="input">{Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select>
        </label>
        <div className="col-span-2 flex items-end gap-2 md:col-span-4 xl:col-span-8">
          <button className="btn-primary">Apply</button>
          <Link href={`/leads${view !== "all" ? `?view=${view}` : ""}`} className="btn-ghost">Reset</Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card">
          <Empty action={isCoord && total === 0 && !currentQuery ? <div className="flex justify-center gap-2"><Link href="/leads/new" className="btn-primary">Add a lead</Link><Link href="/import" className="btn-secondary">Import leads</Link></div> : undefined}>
            {currentQuery ? "No leads match these filters." : isCoord ? "No leads yet." : "No leads are assigned to you yet."}
          </Empty>
        </div>
      ) : (
        <LeadTable
          canBulk={can(actor, "lead.bulk")}
          reps={reps}
          areas={areas}
          statuses={LEAD_STATUSES.map((s) => ({ value: s, label: LEAD_STATUS_LABEL[s] }))}
          priorities={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
          rows={rows.map((l) => ({
            id: l.id,
            leadNumber: l.leadNumber,
            businessName: l.businessName,
            contactName: l.contactName,
            areaName: l.area?.name ?? null,
            territoryColor: l.territory?.color ?? null,
            repName: l.assignedRep?.name ?? null,
            statusBadge: <LeadStatusBadge s={l.status} />,
            priorityBadge: <PriorityBadge p={l.priority} quietNormal />,
            lastVisited: l.lastVisitAt ? fmtDate(l.lastVisitAt, tz) : "Never",
            lastFeedback: l.latestFeedback,
            nextFollowUp: l.nextFollowUpAt ? <span className="inline-flex items-center gap-1">{fmtDate(l.nextFollowUpAt, tz, { month: "short", day: "numeric" })} <DueBadge due={l.nextFollowUpAt} now={now} tz={tz} /></span> : <span className="text-muted">—</span>,
            nextAppointment: l.nextAppointmentAt ? fmtDateTime(l.nextAppointmentAt, tz) : "—",
            archived: Boolean(l.archivedAt),
            demo: l.isDemo,
          }))}
        />
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted">
          {page > 1 && <Link className="btn-secondary btn-sm" href={pageHref(page - 1)}>← Previous</Link>}
          {total > 0 && <span>Showing {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}</span>}
          {page * pageSize < total && <Link className="btn-secondary btn-sm" href={pageHref(page + 1)}>Next →</Link>}
        </div>
        {currentQuery && (
          <ActionForm action={saveViewAction} className="flex items-end gap-2" resetOnSuccess>
            <input type="hidden" name="query" value={currentQuery} />
            <label className="block"><span className="label">Save these filters as a view</span><input name="name" className="input" placeholder="e.g. North side, high priority" required maxLength={60} /></label>
            <SubmitButton className="btn-secondary">Save view</SubmitButton>
          </ActionForm>
        )}
      </div>
      {saved.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          Saved views:
          {saved.map((v) => (
            <ActionForm key={v.id} action={deleteViewAction} confirm={`Delete saved view “${v.name}”?`} className="inline">
              <input type="hidden" name="id" value={v.id} />
              <SubmitButton className="rounded-full border border-line bg-white px-2 py-0.5 text-xs hover:border-red-300 hover:text-red-700">{v.name} ✕</SubmitButton>
            </ActionForm>
          ))}
        </div>
      )}
    </div>
  );
}
