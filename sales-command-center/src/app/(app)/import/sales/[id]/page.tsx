import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth";
import { can } from "@/server/policy";
import { getSettings } from "@/server/settings";
import { repOptions } from "@/server/options";
import { getSalesImport, type SalePlan } from "@/server/services/salesImports";
import { sp, type SP } from "@/server/services/leadQuery";
import { Badge, Empty, Flash, PageHeader, Section } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { applySalesImportAction } from "@/app/actions/salesImports";
import { reportPersonName } from "@/lib/domain/salesReport";
import { fmtDateKey, fmtDateTime } from "@/lib/time";

export const metadata = { title: "Import sales" };

function What({ p }: { p: SalePlan }) {
  if (p.action === "done") return p.status === "SKIPPED" ? <Badge tone="muted">Skipped</Badge> : <span className="space-x-1"><Badge tone="good">Recorded</Badge>{p.existing && <Link className="link text-xs" href={`/sales/${p.existing.id}`}>O-{p.existing.oppNumber}</Link>}</span>;
  if (p.action === "blocked") return <span className="text-sm text-red-700">{p.problem}</span>;
  if (p.action === "create") return <Badge tone="accent">New sale</Badge>;
  if (p.action === "unchanged") return <span className="space-x-1"><Badge tone="muted">Already up to date</Badge><Link className="link text-xs" href={`/sales/${p.existing!.id}`}>O-{p.existing!.oppNumber}</Link></span>;
  return <span className="space-y-1"><Badge tone="warn">Update O-{p.existing!.oppNumber}</Badge><span className="block text-xs text-muted">Changes: {p.changes.join(", ")}</span></span>;
}

export default async function SalesImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const q = await searchParams;
  const actor = await requireActor();
  if (!can(actor, "sales.editAll")) return <div className="card"><Empty>Only the coordinator can import sales.</Empty></div>;
  const rep = sp(q, "rep");
  const as = sp(q, "as") ?? null;
  const d = await getSalesImport(actor, id, rep && rep !== "*" ? rep : null, as).catch(() => null);
  if (!d) notFound();
  const repList = await repOptions();
  const tz = (await getSettings()).timezone;
  const { meta, reps, plans } = d;
  const chosen = rep ? plans : [];
  const actionable = chosen.filter((p) => p.action === "create" || p.action === "update");
  const repLabel = rep === "*" ? "all reps" : rep ? reportPersonName(rep) : "";

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: "/import", label: "Import" }}
        title="Import sales report"
        subtitle={<>{meta?.fileName}{meta?.generatedOn && <> · generated {meta.generatedOn}</>}{meta?.period && <> · sales {meta.period}</>} · uploaded {fmtDateTime(d.batch.createdAt, tz)} by {d.batch.createdBy.name}</>}
      />
      <Flash message={sp(q, "msg")} />
      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        Each PN/Job # becomes one <b>won sale</b> on the lead with that prospect #. The <b>Survey Result</b> is saved as the GO status, the 44 check box as <b>Signed 44</b>, and the Run Date as the run date, all exactly as printed. RVOL, AVOL, Confirmer, Analyst, MS Status and the other columns are kept on the sale too. The report has <b>no dollar amounts</b>, so none are recorded: these sales count as closed sales but add nothing to revenue. Uploading the same report again updates these sales instead of adding duplicates.
      </div>
      {!!meta?.problems.length && (
        <div role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>Some of the PDF couldn&apos;t be read:</b>
          <ul className="ml-5 list-disc">{meta.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <Section title="Whose sales?" subtitle="Pick the sales rep from the report. Only that rep's sales are shown and recorded.">
        <div className="flex flex-wrap gap-2 p-4">
          {reps.map((r) => (
            <Link key={r.name} href={`/import/sales/${id}?rep=${encodeURIComponent(r.name)}`} className={r.name === rep ? "btn-primary" : "btn-secondary"}>
              {reportPersonName(r.name)} <span className="opacity-70">({r.count})</span>
            </Link>
          ))}
          <Link href={`/import/sales/${id}?rep=*`} className={rep === "*" ? "btn-primary" : "btn-ghost"}>All reps</Link>
        </div>
      </Section>

      {rep && (chosen.some((p) => p.problem?.startsWith("No rep")) || as) && (
        <form method="get" className="card flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="rep" value={rep} />
          <label className="block">
            <span className="label">Record sales without a rep under</span>
            <select name="as" defaultValue={as ?? ""} className="input">
              <option value="">— choose a rep —</option>
              {repList.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <button className="btn-secondary">Use this rep</button>
          <p className="w-full text-xs text-muted">Used only when the report&apos;s rep has no account here and the lead isn&apos;t assigned to anyone.</p>
        </form>
      )}

      {rep && (
        <ActionForm action={applySalesImportAction} confirm={`Record the ticked sales for ${repLabel}? Each one is saved as a won sale with no dollar amount, and its lead is marked Won.`}>
          <input type="hidden" name="batchId" value={id} />
          <input type="hidden" name="rep" value={rep} />
          {as && <input type="hidden" name="as" value={as} />}
          <input type="hidden" name="confirmed" value="true" />
          <Section
            title={`Sales for ${repLabel} (${chosen.length})`}
            subtitle={actionable.length ? "Ticked sales are recorded when you press the button. Untick any you don't want." : "Nothing left to record for this rep."}
            action={actionable.length ? (
              <span className="flex flex-wrap gap-2">
                <button type="submit" className="btn-primary" name="decision" value="record">Record ticked sales</button>
                <button type="submit" className="btn-secondary" name="decision" value="skip" data-confirm="Skip the ticked sales? They won't be recorded from this upload.">Skip ticked</button>
              </span>
            ) : undefined}
          >
            {chosen.length ? (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr><th aria-label="Record" /><th>PN/Job #</th><th>Lead in the app</th><th>Sale date</th><th>Run date</th><th>44</th><th>GO status (Survey Result)</th><th>RVOL / AVOL</th><th>What happens</th></tr>
                  </thead>
                  <tbody>
                    {chosen.map((p) => {
                      const can = p.action === "create" || p.action === "update";
                      return (
                        <tr key={p.recordId} className={p.action === "blocked" ? "bg-red-50/40" : undefined}>
                          <td>{can && <input type="checkbox" name="ids" value={p.recordId} defaultChecked={!p.handEntered.length} aria-label={`Record job ${p.sale.ref}`} className="size-4" />}</td>
                          <td className="whitespace-nowrap tabular-nums">{p.sale.ref}<div className="text-xs text-muted">row {p.sale.rowNumbers.join(", ")}</div></td>
                          <td>
                            {p.lead ? <Link className="link" href={`/leads/${p.lead.id}?tab=sales`}>{p.lead.businessName}</Link> : <span className="text-muted">{p.sale.company} (not in the app)</span>}
                            {p.repName && <div className="text-xs text-muted">Rep: {p.repName}</div>}
                            {!!p.handEntered.length && p.action !== "done" && (
                              <div className="mt-1 text-xs text-amber-800">
                                This lead already has {p.handEntered.map((h, i) => <span key={h.id}>{i ? ", " : ""}<Link className="link" href={`/sales/${h.id}`}>O-{h.oppNumber} ({h.product})</Link></span>)} entered by hand. Check it isn&apos;t the same sale before ticking.
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap">{p.sale.saleDate ? fmtDateKey(p.sale.saleDate) : "—"}</td>
                          <td className="whitespace-nowrap">{p.sale.runDate ? fmtDateKey(p.sale.runDate) : "—"}</td>
                          <td>{p.sale.signed44 ? "Yes" : "No"}</td>
                          <td className="text-sm">{p.sale.goStatus ?? <span className="text-muted">blank</span>}</td>
                          <td className="whitespace-nowrap text-sm tabular-nums">{p.sale.details.RVOL ?? "—"} / {p.sale.details.AVOL ?? "—"}</td>
                          <td><What p={p} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No sales for this rep in the report.</Empty>}
          </Section>
        </ActionForm>
      )}
    </div>
  );
}
