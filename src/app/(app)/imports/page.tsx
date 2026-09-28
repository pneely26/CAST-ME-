import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { ImportWizard } from "./ImportWizard";
import { PUBLIC_FIELDS, AGENCY_FIELDS } from "@/lib/import/mapping";
import { adapters } from "@/lib/adapters/registry";
import { Badge, PageHeader, Section, Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Imports" };

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const agency = tab === "agency";
  const batches = await prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Imports"
        description="Two separate workflows. Nothing is imported until you review the preview and confirm; existing records are never overwritten without confirmation."
      />
      <div className="flex gap-1 rounded-lg border border-line bg-white p-1 text-sm sm:w-fit">
        <Link href="/imports" className={`flex-1 rounded-md px-4 py-2 text-center ${!agency ? "bg-ink text-white" : "text-ink-soft hover:bg-paper"}`}>Public breakdowns</Link>
        <Link href="/imports?tab=agency" className={`flex-1 rounded-md px-4 py-2 text-center ${agency ? "bg-ink text-white" : "text-ink-soft hover:bg-paper"}`}>Agency submissions</Link>
      </div>
      <div className="rounded-md border border-line bg-white px-4 py-3 text-xs text-ink-soft">
        {agency ? (
          <>Import the submission list your agency shares with you (CSV/XLSX). This is private data — it stays in your database. After import, each row is compared with the public dataset. Sample file: <a className="link" href="/samples/demo-agency-submissions.csv" download>demo CSV</a> · <a className="link" href="/samples/demo-agency-submissions.xlsx" download>demo XLSX</a>.</>
        ) : (
          <>Import public casting listings you compiled from sources you can access (CSV/XLSX/JSON). Don’t import agent-only material. Sample file: <a className="link" href="/samples/demo-public-breakdowns.csv" download>demo CSV</a> · <a className="link" href="/samples/demo-public-breakdowns.json" download>demo JSON</a>.</>
        )}
      </div>
      <ImportWizard key={agency ? "a" : "p"} kind={agency ? "AGENCY_SUBMISSION" : "PUBLIC_BREAKDOWN"} fields={agency ? AGENCY_FIELDS : PUBLIC_FIELDS} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Recent imports">
          {batches.length === 0 ? <Empty>No imports yet.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {batches.map((b) => (
                <li key={b.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{b.fileName}</span><Badge tone={b.kind === "PUBLIC_BREAKDOWN" ? "accent" : "signal"}>{b.kind === "PUBLIC_BREAKDOWN" ? "Public" : "Agency"}</Badge></div>
                  <div className="text-xs text-muted">{fmtDateTime(b.createdAt)} · {b.rowsFound} found · {b.rowsValid} valid · {b.rowsInvalid} invalid · {b.imported} imported</div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Source adapters" subtitle="Modular sources. Automated adapters are only enabled for sources whose terms permit it.">
          <ul className="divide-y divide-line text-sm">
            {adapters.map((a) => (
              <li key={a.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{a.name}</span><Badge tone={a.enabled ? "good" : "muted"}>{a.enabled ? "Enabled" : "Disabled"}</Badge></div>
                <div className="text-xs text-muted">{a.id} · {a.mode === "MANUAL_IMPORT" ? "Manual import" : "Scheduled"} · {a.compliance.basis}</div>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
