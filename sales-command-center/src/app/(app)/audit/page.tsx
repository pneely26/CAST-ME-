import Link from "next/link";
import { requireActor } from "@/server/auth";
import { can } from "@/server/policy";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { AUDIT_AREAS, listAudit } from "@/server/services/auditQuery";
import { sp, type SP } from "@/server/services/leadQuery";
import { Empty, PageHeader } from "@/components/ui";
import { RangePicker } from "@/components/RangePicker";
import { fmtDateTime, resolveRange } from "@/lib/time";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  if (!can(actor, "audit.view")) return <div className="card"><Empty>Only the coordinator can view the audit log.</Empty></div>;
  const tz = (await getSettings()).timezone;
  const range = resolveRange(sp(params, "range") ?? "all", sp(params, "from"), sp(params, "to"), tz);
  const page = Number(sp(params, "page") ?? 1) || 1;
  const [{ rows, total, pages }, users] = await Promise.all([listAudit(actor, params, range, { page }), prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const keep = Object.fromEntries(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" && v && !["page"].includes(k) ? [[k, v]] : [])));
  const extra = Object.fromEntries(Object.entries(keep).filter(([k]) => !["range", "from", "to"].includes(k)));
  const qs = (o: Record<string, string | number>) => new URLSearchParams({ ...keep, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) }).toString();
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle={`${total} recorded change(s). Entries can't be edited or deleted from the app.`} actions={<a className="btn-secondary" href={`/api/export/audit?${qs({})}`}>Export CSV</a>} />
      <div className="flex flex-wrap items-end gap-3">
        <RangePicker range={range} basePath="/audit" extra={extra} allowAll />
        <form method="get" className="flex flex-wrap items-end gap-2">
          {range.preset !== "all" && <input type="hidden" name="range" value={range.preset} />}
          {range.preset === "custom" && <><input type="hidden" name="from" value={range.startKey} /><input type="hidden" name="to" value={range.endKey} /></>}
          <select name="area" defaultValue={sp(params, "area") ?? ""} className="input py-1" aria-label="Area"><option value="">Everything</option>{Object.entries(AUDIT_AREAS).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}</select>
          <select name="actor" defaultValue={sp(params, "actor") ?? ""} className="input py-1" aria-label="Person"><option value="">Anyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}<option value="system">System / command line</option></select>
          <input name="q" defaultValue={sp(params, "q") ?? ""} placeholder="Search summaries" className="input py-1" aria-label="Search" />
          <button className="btn-secondary py-1">Filter</button>
        </form>
      </div>
      <div className="card overflow-x-auto">
        {rows.length ? (
          <table className="tbl">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Lead</th><th>Action</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap">{fmtDateTime(r.createdAt, tz)}</td>
                  <td className="whitespace-nowrap">{r.actor?.name ?? <span className="text-muted">System</span>}</td>
                  <td>
                    {r.summary}
                    {r.data && typeof r.data === "object" && !Array.isArray(r.data) && Object.keys(r.data).length > 0 && (
                      <details className="text-xs text-muted">
                        <summary className="cursor-pointer">Changed fields</summary>
                        <ul className="mt-1 space-y-0.5">
                          {Object.entries(r.data as Record<string, unknown>).map(([k, v]) => (
                            <li key={k}><b>{k}</b>: {Array.isArray(v) && v.length === 2 ? <>{String(v[0] ?? "—")} → {String(v[1] ?? "—")}</> : JSON.stringify(v)}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td>{r.lead ? <Link className="link" href={`/leads/${r.lead.id}?tab=activity`}>{r.lead.businessName}</Link> : "—"}</td>
                  <td className="whitespace-nowrap font-mono text-xs text-muted">{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No entries match.</Empty>}
      </div>
      {pages > 1 && (
        <nav className="flex items-center gap-2 text-sm" aria-label="Pages">
          {page > 1 && <Link className="btn-secondary btn-sm" href={`/audit?${qs({ page: page - 1 })}`}>Newer</Link>}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages && <Link className="btn-secondary btn-sm" href={`/audit?${qs({ page: page + 1 })}`}>Older</Link>}
        </nav>
      )}
    </div>
  );
}
