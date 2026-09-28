import { monthlyReport, weeklyReport, type Report } from "@/lib/server/reports";
import { PageHeader, Section } from "@/components/ui";
import { HBarChart } from "@/components/Charts";
import { str, type SP } from "@/lib/server/filters";

export const metadata = { title: "Reports" };

function Exports({ href }: { href: string }) {
  const sep = href.includes("?") ? "&" : "?";
  return (
    <div className="flex flex-wrap gap-2">
      {(["csv", "xlsx", "pdf"] as const).map((f) => (
        <a key={f} href={`${href}${sep}format=${f}`} className="btn-secondary text-xs uppercase">{f}</a>
      ))}
    </div>
  );
}

function ReportView({ report }: { report: Report }) {
  return (
    <div className="space-y-4">
      {report.sections.map((s) => (
        <div key={s.title}>
          <h3 className="text-sm font-semibold">{s.title} <span className="font-normal text-muted">({s.rows.length})</span></h3>
          {s.note && <p className="text-xs text-muted">{s.note}</p>}
          <div className="mt-2 overflow-x-auto rounded-md border border-line">
            <table className="table-base">
              <thead><tr>{s.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {s.rows.length === 0 ? <tr><td colSpan={s.columns.length} className="text-muted">None</td></tr> : s.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const now = new Date();
  const monthParam = str(sp, "month");
  const m = monthParam && /^(\d{4})-(\d{2})$/.exec(monthParam);
  const year = m ? Number(m[1]) : now.getUTCFullYear();
  const month = m ? Number(m[2]) : now.getUTCMonth() + 1;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const [weekly, monthly] = await Promise.all([weeklyReport(now), monthlyReport(year, month, now)]);
  const toChart = (title: string) => (monthly.sections.find((s) => s.title === title)?.rows ?? []).map((r) => ({ name: String(r[0]), value: Number(r[1]) }));

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Weekly and monthly summaries. Exports contain private agency information — keep them private." />

      <Section title={`Monthly report — ${monthly.periodLabel}`} action={<Exports href={`/api/reports/monthly?month=${monthKey}`} />}>
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3" method="get">
          <label className="block"><span className="label">Month</span><input type="month" name="month" defaultValue={monthKey} className="input" /></label>
          <button className="btn-secondary">Show</button>
        </form>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
          {monthly.sections[0].rows.map((r) => (
            <div key={String(r[0])} className="rounded-md border border-line px-3 py-2">
              <div className="text-[11px] uppercase leading-tight tracking-wide text-muted">{r[0]}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{r[1]}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 px-4 pb-4 lg:grid-cols-3">
          <div><h3 className="mb-1 text-sm font-semibold">Projects by platform</h3><HBarChart data={toChart("Projects by platform")} /></div>
          <div><h3 className="mb-1 text-sm font-semibold">Projects by region</h3><HBarChart data={toChart("Projects by region")} /></div>
          <div><h3 className="mb-1 text-sm font-semibold">Projects by casting director</h3><p className="text-xs text-muted">Frequency only — not a ranking.</p><HBarChart data={toChart("Projects by casting director")} /></div>
        </div>
      </Section>

      <Section title={`Weekly casting report — ${weekly.periodLabel}`} action={<Exports href="/api/reports/weekly" />}>
        <div className="p-4"><ReportView report={weekly} /></div>
      </Section>
    </div>
  );
}
