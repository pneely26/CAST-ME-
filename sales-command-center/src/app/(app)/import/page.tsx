import Link from "next/link";
import { requireActor } from "@/server/auth";
import { can } from "@/server/policy";
import { getSettings } from "@/server/settings";
import { listBatches } from "@/server/services/imports";
import { extractionStatus } from "@/server/extraction";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { uploadCsvAction, uploadScreenshotsAction } from "@/app/actions/imports";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Import Leads" };

export default async function ImportPage() {
  const actor = await requireActor();
  if (!can(actor, "lead.import")) return <div className="card"><Empty>Only the coordinator can import leads.</Empty></div>;
  const [batches, settings] = await Promise.all([listBatches(actor), getSettings()]);
  const provider = extractionStatus();
  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader title="Import Leads" subtitle="Upload screenshots or a CSV file. Every row is reviewed before it becomes a lead — nothing is added automatically, and duplicates are flagged." />
      {provider.configured ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Screenshot reading is on: <b>{provider.label}</b>. Images are sent to this provider from the server only. Values it can&apos;t see are left blank, never guessed.</p>
      ) : (
        <div role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>Screenshot reading is not configured.</b> No OCR or vision provider is set up, so text will not be read from images automatically. You can still upload screenshots: they&apos;re stored with the import and you can type each lead in while viewing the image. To turn on automatic reading, set <code>ANTHROPIC_API_KEY</code> in the server&apos;s <code>.env</code> and restart. CSV import works either way.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Screenshots" subtitle="PNG, JPEG, WebP or GIF · up to 30 images, 25 MB per upload">
          <ActionForm action={uploadScreenshotsAction} className="space-y-3 p-4">
            <input type="file" name="files" accept="image/png,image/jpeg,image/webp,image/gif" multiple required className="block w-full text-sm" aria-label="Screenshots" />
            <input name="notes" className="input" placeholder="Where these came from (optional), e.g. Google Maps — pizza, Lincoln Park" maxLength={1000} />
            <SubmitButton>Upload screenshots</SubmitButton>
          </ActionForm>
        </Section>
        <Section title="CSV file" subtitle="First row must be column names. Columns are matched to lead fields; you can change the matching on the next screen.">
          <ActionForm action={uploadCsvAction} className="space-y-3 p-4">
            <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-sm" aria-label="CSV file" />
            <SubmitButton>Upload CSV</SubmitButton>
          </ActionForm>
        </Section>
      </div>
      <Section title="Imports">
        {batches.length ? (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Started</th><th>Type</th><th>By</th><th className="text-right">Rows</th><th>Progress</th><th /></tr></thead>
              <tbody>
                {batches.map((b) => {
                  const sc = b.statusCounts;
                  return (
                    <tr key={b.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(b.createdAt, settings.timezone)}</td>
                      <td>{b.kind === "CSV" ? "CSV" : `${b._count.images} screenshot(s)`}</td>
                      <td>{b.createdBy.name}</td>
                      <td className="text-right tabular-nums">{b._count.records}</td>
                      <td className="space-x-1">
                        {b.completedAt ? <Badge tone="good">Complete</Badge> : <Badge tone="warn">{sc.PENDING ?? 0} to review</Badge>}
                        {!!sc.IMPORTED && <Badge tone="good">{sc.IMPORTED} created</Badge>}
                        {!!sc.MERGED && <Badge tone="accent">{sc.MERGED} merged</Badge>}
                        {!!sc.SKIPPED && <Badge tone="muted">{sc.SKIPPED} skipped</Badge>}
                      </td>
                      <td><Link className="link" href={`/import/${b.id}`}>Review</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty>No imports yet.</Empty>}
      </Section>
    </div>
  );
}
