import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { listOpportunities } from "@/server/services/salesQuery";
import { sp, type SP } from "@/server/services/leadQuery";
import { repOptions, areaOptions } from "@/server/options";
import { Badge, DemoBadge, Empty, Flash, PageHeader, Stat } from "@/components/ui";
import { OppStatusBadge } from "@/components/badges";
import { RangePicker } from "@/components/RangePicker";
import { summarizeSales } from "@/lib/domain/sales";
import { OPPORTUNITY_STATUSES, OPPORTUNITY_STATUS_LABEL, PAYMENT_STATUS_LABEL, money, pct } from "@/lib/labels";
import { fmtDate, resolveRange } from "@/lib/time";

export const metadata = { title: "Sales" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  const tz = (await getSettings()).timezone;
  const range = resolveRange(sp(params, "range") ?? "month", sp(params, "from"), sp(params, "to"), tz);
  const isCoord = actor.role === "COORDINATOR";
  const [rows, reps, areas] = await Promise.all([listOpportunities(actor, params, range), isCoord ? repOptions() : Promise.resolve([]), areaOptions()]);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const s = summarizeSales(rows.map((o) => ({ ...o, estimatedValue: num(o.estimatedValue), finalAmount: num(o.finalAmount), commissionAmount: num(o.commissionAmount) })), range.preset === "all" ? undefined : range);
  const view = sp(params, "view") ?? "all";
  const status = sp(params, "status");
  const keep = Object.fromEntries(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" && v && !["range", "from", "to", "msg"].includes(k) ? [[k, v]] : [])));
  const qs = new URLSearchParams({ ...keep, range: range.preset, ...(range.preset === "custom" ? { from: range.startKey, to: range.endKey } : {}) }).toString();
  const rangeQ = `range=${range.preset}${range.preset === "custom" ? `&from=${range.startKey}&to=${range.endKey}` : ""}`;
  const open = rows.filter((o) => !["WON", "LOST"].includes(o.status));
  const closed = rows.filter((o) => ["WON", "LOST"].includes(o.status));

  const Table = ({ items }: { items: typeof rows }) => (
    <div className="card overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>#</th><th>Business</th><th>Product / service</th><th>Status</th><th className="text-right">Estimated</th><th className="text-right">Final amount</th><th>Opened</th><th>Closed</th><th>Payment</th>{isCoord && <th>Rep</th>}</tr></thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id}>
              <td><Link className="link" href={`/sales/${o.id}`}>O-{o.oppNumber}</Link></td>
              <td><Link className="hover:underline" href={`/leads/${o.lead.id}?tab=sales`}>{o.lead.businessName}</Link> <DemoBadge show={o.isDemo} /><div className="text-xs text-muted">{o.lead.area?.name}</div></td>
              <td>{o.product}</td>
              <td><OppStatusBadge s={o.status} /></td>
              <td className="text-right tabular-nums text-muted">{money(num(o.estimatedValue))}</td>
              <td className="text-right font-medium tabular-nums">{o.status === "WON" ? money(num(o.finalAmount)) : "—"}</td>
              <td className="whitespace-nowrap">{fmtDate(o.openedAt, tz)}</td>
              <td className="whitespace-nowrap">{o.closedAt ? fmtDate(o.closedAt, tz) : "—"}</td>
              <td>{o.status === "WON" ? PAYMENT_STATUS_LABEL[o.paymentStatus] : "—"}</td>
              {isCoord && <td>{o.rep.name}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title={isCoord ? "Sales & Opportunities" : "My Sales"} subtitle={`Closed sales and revenue: deals closed won in ${range.label.toLowerCase()}. Pipeline: open opportunities' estimated value (not revenue).`} actions={<><a className="btn-secondary" href={`/api/export/sales?${qs}`}>Export CSV</a><Link className="btn-primary" href="/sales/new">New opportunity</Link></>} />
      <Flash message={sp(params, "msg")} />
      <RangePicker range={range} basePath="/sales" extra={keep} allowAll />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Deals won" value={s.wonCount} href={`/sales?status=WON&${rangeQ}`} tone="good" />
        <Stat label="Realized revenue" value={money(s.revenue)} hint="Closed-won final amounts" href={`/sales?status=WON&${rangeQ}`} />
        <Stat label="Average deal" value={money(s.averageDeal)} />
        <Stat label="Deals lost" value={s.lostCount} href={`/sales?status=LOST&${rangeQ}`} />
        <Stat label="Win rate" value={pct(s.winRate)} hint="Won ÷ (won + lost)" />
        <Stat label="Open pipeline" value={money(s.pipelineValue)} hint={`${s.openCount} open · estimated`} href={`/sales?view=open&${rangeQ}`} tone="accent" />
      </div>
      {s.commission > 0 && <p className="text-sm text-muted">Recorded commission on won deals in this period: <strong className="text-ink">{money(s.commission)}</strong></p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {[["all", "All"], ["open", "Open"], ["closed", "Won & lost"]].map(([k, l]) => <Link key={k} href={`/sales?view=${k}&${rangeQ}`} className={!status && view === k ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{l}</Link>)}
        <form method="get" className="ml-auto flex flex-wrap gap-1">
          <input type="hidden" name="range" value={range.preset} />
          {range.preset === "custom" && <><input type="hidden" name="from" value={range.startKey} /><input type="hidden" name="to" value={range.endKey} /></>}
          <input name="q" defaultValue={sp(params, "q")} className="input py-1" placeholder="Business or product" aria-label="Search" />
          <select name="status" defaultValue={status ?? ""} className="input py-1" aria-label="Status"><option value="">Any status</option>{OPPORTUNITY_STATUSES.map((x) => <option key={x} value={x}>{OPPORTUNITY_STATUS_LABEL[x]}</option>)}</select>
          <select name="area" defaultValue={sp(params, "area") ?? ""} className="input py-1" aria-label="Area"><option value="">Any area</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
          {isCoord && <select name="rep" defaultValue={sp(params, "rep") ?? ""} className="input py-1" aria-label="Rep"><option value="">All reps</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
          <button className="btn-secondary btn-sm">Filter</button>
        </form>
      </div>
      {rows.length === 0 ? <div className="card"><Empty action={<Link href="/sales/new" className="btn-secondary">New opportunity</Link>}>No opportunities in this view.</Empty></div> : (
        <>
          {open.length > 0 && view !== "closed" && <div><h2 className="mb-2 text-sm font-semibold">Open opportunities <Badge tone="accent">{open.length}</Badge></h2><Table items={open} /></div>}
          {closed.length > 0 && view !== "open" && <div><h2 className="mb-2 text-sm font-semibold">Completed (won & lost) <Badge tone="good">{closed.length}</Badge></h2><Table items={closed} /></div>}
        </>
      )}
    </div>
  );
}
