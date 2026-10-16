import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { listVisits } from "@/server/services/visitQuery";
import { sp, type SP } from "@/server/services/leadQuery";
import { repOptions, areaOptions } from "@/server/options";
import { Badge, Empty, Flash, PageHeader, Section } from "@/components/ui";
import { OutcomeBadge } from "@/components/badges";
import { RangePicker } from "@/components/RangePicker";
import { INTEREST_LABEL, VISIT_OUTCOMES, VISIT_OUTCOME_LABEL, VISIT_TYPE_LABEL } from "@/lib/labels";
import { fmtDateTime, resolveRange, visitDateTime } from "@/lib/time";

export const metadata = { title: "Visits & Feedback" };

export default async function VisitsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  const tz = (await getSettings()).timezone;
  const range = resolveRange(sp(params, "range") ?? "month", sp(params, "from"), sp(params, "to"), tz);
  const isCoord = actor.role === "COORDINATOR";
  const [visits, reps, areas] = await Promise.all([listVisits(actor, params, range), isCoord ? repOptions() : Promise.resolve([]), areaOptions()]);
  const keep = Object.fromEntries(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" && v && !["range", "from", "to", "msg"].includes(k) ? [[k, v]] : [])));
  const qs = new URLSearchParams({ ...keep, range: range.preset, ...(range.preset === "custom" ? { from: range.startKey, to: range.endKey } : {}) }).toString();
  return (
    <div className="space-y-4">
      <PageHeader title={isCoord ? "Visits & Feedback" : "My Visits"} subtitle={`${visits.length} visit record(s) · ${range.label}`} actions={isCoord ? <a className="btn-secondary" href={`/api/export/visits?${qs}`}>Export CSV</a> : undefined} />
      <Flash message={sp(params, "msg")} />
      <RangePicker range={range} basePath="/visits" extra={keep} />
      <form method="get" className="card grid grid-cols-2 gap-3 p-3 md:grid-cols-5">
        <input type="hidden" name="range" value={range.preset} />
        {range.preset === "custom" && <><input type="hidden" name="from" value={range.startKey} /><input type="hidden" name="to" value={range.endKey} /></>}
        <label className="col-span-2 block md:col-span-1"><span className="label">Search feedback</span><input name="q" defaultValue={sp(params, "q")} className="input" /></label>
        <label className="block"><span className="label">Outcome</span><select name="outcome" defaultValue={sp(params, "outcome") ?? ""} className="input"><option value="">Any</option>{VISIT_OUTCOMES.map((o) => <option key={o} value={o}>{VISIT_OUTCOME_LABEL[o]}</option>)}</select></label>
        <label className="block"><span className="label">Area</span><select name="area" defaultValue={sp(params, "area") ?? ""} className="input"><option value="">Any</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        {isCoord && <label className="block"><span className="label">Rep</span><select name="rep" defaultValue={sp(params, "rep") ?? ""} className="input"><option value="">Any</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="feedback" value="1" defaultChecked={sp(params, "feedback") === "1"} /> With feedback only</label>
        <div className="col-span-2 flex gap-2 md:col-span-5"><button className="btn-primary">Apply</button><Link href="/visits" className="btn-ghost">Reset</Link></div>
      </form>
      <Section title="Visit history">
        {visits.length === 0 ? <Empty>No visits in this period.</Empty> : (
          <ul className="divide-y divide-line-2">
            {visits.map((v) => (
              <li key={v.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/leads/${v.lead.id}?tab=visits`} className="font-medium hover:underline">{v.lead.businessName}</Link>
                  <OutcomeBadge o={v.outcome} />
                  <Badge tone="neutral">{VISIT_TYPE_LABEL[v.type]}</Badge>
                  {v.interestLevel && <Badge tone="muted">Interest: {INTEREST_LABEL[v.interestLevel]}</Badge>}
                  <span className="text-xs text-muted">{visitDateTime(v, tz)}{isCoord ? ` · ${v.rep.name}` : ""}{v.lead.area ? ` · ${v.lead.area.name}` : ""}</span>
                </div>
                {v.feedback && <p className="mt-1 whitespace-pre-line text-sm">{v.feedback}</p>}
                {v.objections && <p className="mt-1 text-sm text-ink-2"><span className="text-xs text-muted">Objections: </span>{v.objections}</p>}
                {v.followUpAction && <p className="mt-1 text-xs text-amber-800">Follow-up: {v.followUpAction}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
