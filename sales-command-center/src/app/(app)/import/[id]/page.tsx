import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth";
import { can } from "@/server/policy";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { csvMeta, getBatchForReview, type ReviewView } from "@/server/services/imports";
import { extractionStatus } from "@/server/extraction";
import { sp, type SP } from "@/server/services/leadQuery";
import { areaOptions, repOptions } from "@/server/options";
import { Badge, Empty, Flash, PageHeader, Section, Tabs } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ExtractRunner } from "@/components/ExtractRunner";
import { addManualRecordAction, decideRecordAction, importCleanAction, remapCsvAction, retryImageAction } from "@/app/actions/imports";
import { IMPORT_FIELDS, IMPORT_FIELD_LABEL as FIELD_LABEL, type ImportField } from "@/lib/domain/imports";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Review import" };

type Rec = Awaited<ReturnType<typeof getBatchForReview>>["records"][number];

const STATUS_TONE = { PENDING: "warn", IMPORTED: "good", MERGED: "accent", SKIPPED: "muted", ERROR: "bad" } as const;
const STATUS_LABEL = { PENDING: "To review", IMPORTED: "Created", MERGED: "Merged", SKIPPED: "Skipped", ERROR: "Error" } as const;
const IMG_LABEL: Record<string, string> = { UPLOADED: "Waiting to be read", EXTRACTING: "Reading…", EXTRACTED: "Read", NOT_CONFIGURED: "Not read — no provider", ERROR: "Couldn't read", DUPLICATE: "Duplicate image" };

function DefaultsHidden({ d, back }: { d: { rep?: string; area?: string; source?: string }; back: string }) {
  return (
    <>
      <input type="hidden" name="back" value={back} />
      {d.rep && <input type="hidden" name="assignedRepId" value={d.rep} />}
      {d.area && <input type="hidden" name="areaId" value={d.area} />}
      {d.source && <input type="hidden" name="source" value={d.source} />}
    </>
  );
}

function RecordCard({ r, defaults, imageName, back }: { r: Rec; defaults: { rep?: string; area?: string; source?: string }; imageName?: string; back: string }) {
  const conf = (r.confidence ?? {}) as Partial<Record<ImportField, string | null>>;
  const extracted = (r.extracted ?? {}) as Partial<Record<ImportField, string | null>>;
  const fieldFlags = (f: ImportField) => r.flags.filter((x) => x.field === f);
  const pending = r.status === "PENDING";
  const blocking = r.flags.some((f) => f.level === "error");
  return (
    <article className="card" aria-label={`Row ${r.rowNumber ?? ""}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="font-medium">Row {r.rowNumber}</span>
        <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        {pending && r.clean && !r.duplicates.length && <Badge tone="good">Ready</Badge>}
        {pending && r.idMatch && <Badge tone="accent">Updates lead #{r.idMatch.leadNumber}</Badge>}
        {pending && r.follower && <Badge tone="accent">Same prospect as an earlier row</Badge>}
        {pending && r.rep && <span className="text-xs text-muted">Rep: {r.rep.name}</span>}
        {pending && !!r.duplicates.length && <Badge tone="bad">Possible duplicate</Badge>}
        {imageName && r.imageId && <a className="text-xs text-muted hover:underline" href={`/api/files/import/${r.imageId}`} target="_blank" rel="noreferrer">from {imageName}</a>}
        {r.lead && <Link className="link ml-auto text-sm" href={`/leads/${r.lead.id}`}>Lead #{r.lead.leadNumber} {r.lead.businessName}</Link>}
      </header>
      {pending ? (
        <ActionForm action={decideRecordAction} className="space-y-3 p-4">
          <input type="hidden" name="id" value={r.id} />
          <DefaultsHidden d={defaults} back={back} />
          {!!r.flags.length && (
            <ul className="space-y-0.5 text-sm">
              {r.flags.map((f, i) => (
                <li key={i} className={f.level === "error" ? "text-red-700" : f.level === "warn" ? "text-amber-800" : "text-sky-800"}>
                  {f.level === "error" ? "✕" : f.level === "warn" ? "!" : "i"} {f.field ? `${FIELD_LABEL[f.field]}: ` : ""}{f.message}
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {IMPORT_FIELDS.map((f) => {
              const ff = fieldFlags(f);
              const tone = ff.some((x) => x.level === "error") ? "border-red-400" : ff.some((x) => x.level === "warn") ? "border-amber-400" : "";
              const edited = r.edited && f in (r.edited as object);
              return (
                <label key={f} className={f === "notes" ? "block sm:col-span-2 lg:col-span-3" : "block"}>
                  <span className="label flex items-center gap-1">
                    {FIELD_LABEL[f]}
                    {f === "businessName" && <span className="text-red-600">*</span>}
                    {conf[f] && <span className={`text-[10px] font-normal ${conf[f] === "high" ? "text-muted" : "text-amber-700"}`}>({conf[f]} confidence)</span>}
                    {edited && <span className="text-[10px] font-normal text-accent" title={`Read as: ${extracted[f] ?? "(blank)"}`}>(corrected)</span>}
                  </span>
                  {f === "notes" ? (
                    <textarea name={f} defaultValue={r.values[f] ?? ""} rows={2} className={`input ${tone}`} placeholder="Not in source" />
                  ) : (
                    <input name={f} defaultValue={r.values[f] ?? ""} className={`input ${tone}`} placeholder="Not in source" />
                  )}
                </label>
              );
            })}
          </div>
          {Object.keys(r.details).length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">Other columns from the file ({Object.keys(r.details).length}) — kept on the lead exactly as written</summary>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 rounded bg-canvas p-2 sm:grid-cols-4">
                {Object.entries(r.details).map(([k, val]) => <div key={k} className="min-w-0"><dt className="truncate font-medium text-ink-2">{k}</dt><dd className="truncate">{val}</dd></div>)}
              </dl>
            </details>
          )}
          {r.sourceText && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">Source text (as read)</summary>
              <pre className="mt-1 whitespace-pre-wrap rounded bg-canvas p-2 font-mono text-[11px] text-ink-2">{r.sourceText}</pre>
            </details>
          )}
          {!!r.duplicates.length && (
            <div className="overflow-x-auto rounded-md border border-red-200">
              <table className="tbl text-xs">
                <thead><tr><th>Compare</th><th>This row</th>{r.duplicates.map((d) => <th key={d.id}>Existing #{d.lead.leadNumber}{d.lead.archivedAt ? " (archived)" : ""}</th>)}</tr></thead>
                <tbody>
                  {(["businessName", "phone", "email", "address", "city"] as const).map((f) => (
                    <tr key={f}><td className="font-medium">{FIELD_LABEL[f]}</td><td>{r.values[f] ?? "—"}</td>{r.duplicates.map((d) => <td key={d.id}>{d.lead[f] ?? "—"}</td>)}</tr>
                  ))}
                  <tr><td className="font-medium">Why flagged</td><td />{r.duplicates.map((d) => <td key={d.id}>{d.reasons.join(", ")}</td>)}</tr>
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button name="decision" value="save" className="btn-secondary">Save corrections</button>
            {r.duplicates.map((d) => (
              <button key={d.id} name="decision" value={`merge:${d.id}`} className="btn-primary" data-confirm={`Merge into existing lead #${d.lead.leadNumber} ${d.lead.businessName}? Only empty fields on that lead are filled; its existing values are kept and this row's notes are appended.`}>Merge into #{d.lead.leadNumber}</button>
            ))}
            {r.duplicates.length ? (
              <button name="decision" value="create-duplicate" className="btn-secondary" disabled={blocking} data-confirm="Create a separate new lead even though it looks like an existing one?">Create as new anyway</button>
            ) : (
              <button name="decision" value="create" className="btn-primary" disabled={blocking}>Create lead</button>
            )}
            <button name="decision" value="skip" className="btn-ghost">Skip</button>
          </div>
        </ActionForm>
      ) : (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <span>{r.values.businessName ?? "(no name)"}{r.values.phone ? ` · ${r.values.phone}` : ""}{r.values.address ? ` · ${r.values.address}` : ""}</span>
          {r.error && <span className="text-xs text-muted">{r.error}</span>}
          {r.status === "SKIPPED" && (
            <ActionForm action={decideRecordAction} showSuccess={false} className="ml-auto">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="back" value={back} />
              <button name="decision" value="restore" className="btn-ghost btn-sm">Restore for review</button>
            </ActionForm>
          )}
        </div>
      )}
    </article>
  );
}

export default async function ImportReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const q = await searchParams;
  const actor = await requireActor();
  if (!can(actor, "lead.import")) return <div className="card"><Empty>Only the coordinator can import leads.</Empty></div>;
  if ((await prisma.importBatch.findUnique({ where: { id }, select: { kind: true } }))?.kind === "SALES_REPORT") redirect(`/import/sales/${id}`);
  const view = (["pending", "attention", "clean", "done", "all"].includes(sp(q, "view") ?? "") ? sp(q, "view") : "pending") as ReviewView;
  const page = Number(sp(q, "page") ?? 1) || 1;
  const [d, settings, reps, areas] = await Promise.all([getBatchForReview(actor, id, { view, page }), getSettings(), repOptions(), areaOptions()]);
  const { batch, counts, imageCounts } = d;
  const provider = extractionStatus();
  const metaForDefaults = csvMeta(batch);
  const hasCity = !!metaForDefaults && Object.values(metaForDefaults.mapping).includes("city");
  // CSV files with a city column default to placing each lead in its city's area
  const defaults = { rep: sp(q, "rep"), area: sp(q, "area") ?? (hasCity ? "city" : "none"), source: sp(q, "source") };
  const keep = Object.fromEntries(Object.entries(defaults).filter(([, v]) => v)) as Record<string, string>;
  const href = (o: Record<string, string | number>) => `/import/${id}?${new URLSearchParams({ ...keep, view, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) })}`;
  const meta = csvMeta(batch);
  const imageNames = Object.fromEntries(batch.images.map((i) => [i.id, i.fileName]));
  const queued = provider.configured ? batch.images.filter((i) => i.status === "UPLOADED").map((i) => i.id) : [];

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        back={{ href: "/import", label: "Imports" }}
        title={batch.kind === "CSV" ? `CSV import — ${meta?.fileName ?? ""}` : `Screenshot import — ${batch.images.length} image(s)`}
        subtitle={`Started ${fmtDateTime(batch.createdAt, settings.timezone)} by ${batch.createdBy.name}${batch.provider && batch.kind !== "CSV" ? ` · read with ${batch.provider}` : ""}${batch.kind === "SCREENSHOT" && batch.notes ? ` · ${batch.notes}` : ""}`}
      />
      <Flash message={sp(q, "msg")} />
      <div className="flex flex-wrap gap-2 text-sm" aria-label="Import progress">
        <Badge tone="neutral">{counts.total} row(s)</Badge>
        <Badge tone="warn">{counts.pending} to review</Badge>
        <Badge tone="good">{counts.imported} created</Badge>
        <Badge tone="accent">{counts.merged} merged</Badge>
        <Badge tone="muted">{counts.skipped} skipped</Badge>
        {!!counts.error && <Badge tone="bad">{counts.error} error</Badge>}
        {batch.kind === "SCREENSHOT" && <Badge tone={imageCounts.failed ? "bad" : "neutral"}>{imageCounts.extracted}/{imageCounts.total} images read{imageCounts.failed ? ` · ${imageCounts.failed} failed` : ""}</Badge>}
        {batch.completedAt && <Badge tone="good">Complete</Badge>}
      </div>

      <ExtractRunner imageIds={queued} names={imageNames} />

      {batch.kind === "SCREENSHOT" && (
        <Section title="Screenshots" subtitle={provider.configured ? "Raw text from each image is kept exactly as read." : "No extraction provider is configured — open each image and add its leads by hand below."}>
          <ul className="divide-y divide-line">
            {batch.images.map((img) => (
              <li key={img.id} className="flex flex-col gap-3 p-4 sm:flex-row">
                <a href={`/api/files/import/${img.id}`} target="_blank" rel="noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/import/${img.id}`} alt={`Screenshot ${img.fileName}`} className="h-32 w-48 rounded border border-line object-cover object-top" />
                </a>
                <div className="min-w-0 flex-1 space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{img.fileName}</span>
                    <Badge tone={img.status === "EXTRACTED" ? "good" : img.status === "ERROR" ? "bad" : img.status === "NOT_CONFIGURED" || img.status === "DUPLICATE" ? "muted" : "info"}>{IMG_LABEL[img.status] ?? img.status}</Badge>
                    <span className="text-xs text-muted">{batch.records.filter((r) => r.imageId === img.id).length} row(s)</span>
                  </div>
                  {img.error && <p className={img.status === "ERROR" ? "text-red-700" : "text-amber-800"}>{img.error}</p>}
                  {(img.status === "ERROR" || img.status === "NOT_CONFIGURED") && provider.configured && (
                    <ActionForm action={retryImageAction} showSuccess={false}>
                      <input type="hidden" name="id" value={img.id} />
                      <button className="btn-secondary btn-sm">{img.status === "ERROR" ? "Try reading again" : "Read this image now"}</button>
                    </ActionForm>
                  )}
                  {img.rawText && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted">Raw text from image</summary>
                      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-canvas p-2 font-mono text-[11px]">{img.rawText}</pre>
                    </details>
                  )}
                  {img.status !== "DUPLICATE" && (
                    <details open={img.status === "NOT_CONFIGURED" && !batch.records.some((r) => r.imageId === img.id)}>
                      <summary className="cursor-pointer text-xs text-accent">Add a lead from this image by hand</summary>
                      <ActionForm action={addManualRecordAction} resetOnSuccess className="mt-2 grid gap-2 sm:grid-cols-3">
                        <input type="hidden" name="batchId" value={batch.id} />
                        <input type="hidden" name="imageId" value={img.id} />
                        {(["businessName", "contactName", "phone", "email", "address", "city", "state", "zip", "industry"] as const).map((f) => (
                          <input key={f} name={f} placeholder={FIELD_LABEL[f] + (f === "businessName" ? " *" : "")} required={f === "businessName"} className="input" aria-label={FIELD_LABEL[f]} />
                        ))}
                        <textarea name="notes" placeholder="Notes (kept exactly as typed)" rows={2} className="input sm:col-span-3" aria-label="Notes" />
                        <div className="sm:col-span-3"><SubmitButton>Add row for review</SubmitButton></div>
                      </ActionForm>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {meta && (
        <Section title="Column matching" subtitle={`${meta.preset ? `Recognized layout: ${meta.preset}. ` : ""}Columns not matched to a field are still kept on each lead under “Details from import”, exactly as written. Changing the matching updates rows still under review; corrections you typed are kept.`}>
          <ActionForm action={remapCsvAction} className="grid gap-2 p-4 sm:grid-cols-3 lg:grid-cols-4">
            <input type="hidden" name="batchId" value={batch.id} />
            {meta.headers.map((h, i) => (
              <label key={h} className="block text-sm">
                <span className="label truncate" title={h}>{h}</span>
                <select name={`map_${i}`} defaultValue={meta.mapping[h] ?? ""} className="input">
                  <option value="">— keep as detail —</option>
                  {IMPORT_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                </select>
              </label>
            ))}
            <div className="sm:col-span-3 lg:col-span-4"><SubmitButton>Update matching</SubmitButton></div>
          </ActionForm>
        </Section>
      )}

      <Section title="Defaults for new leads" subtitle="Applied to every lead created from this import. Existing leads are never reassigned by a merge.">
        <form method="get" className="flex flex-wrap items-end gap-2 p-4">
          <input type="hidden" name="view" value={view} />
          <label className="block text-sm"><span className="label">Assign to rep</span>
            <select name="rep" defaultValue={defaults.rep ?? ""} className="input"><option value="">Unassigned</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
          <label className="block text-sm"><span className="label">Area</span>
            <select name="area" defaultValue={defaults.area} className="input"><option value="city">Each lead's city (Somerset, Lexington…) — creates missing areas</option><option value="none">No area</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
          </label>
          <label className="block text-sm"><span className="label">Lead source</span>
            <input name="source" defaultValue={defaults.source ?? ""} placeholder={batch.kind === "CSV" ? "CSV import" : "Screenshot import"} className="input" maxLength={120} />
          </label>
          <button className="btn-secondary">Apply defaults</button>
        </form>
        {counts.clean > 0 && (
          <ActionForm action={importCleanAction} className="border-t border-line p-4" confirm={`Create ${counts.clean} new lead(s) from the rows marked Ready? Rows with problems or possible duplicates stay here for review.`}>
            <input type="hidden" name="batchId" value={batch.id} />
            <DefaultsHidden d={defaults} back={href({})} />
            <SubmitButton>Import {counts.clean} ready row(s)</SubmitButton>
            <span className="ml-2 text-xs text-muted">{d.fullCheck ? "Each is checked for duplicates again as it is created; matches are left for you to decide." : "Large import: duplicates are checked as each row is created; matches are left for you to decide."}</span>
          </ActionForm>
        )}
      </Section>

      <Tabs
        active={view}
        tabs={[
          { key: "pending", label: `To review (${counts.pending})`, href: href({ view: "pending" }) },
          { key: "attention", label: `Needs attention (${counts.pending - counts.clean})`, href: href({ view: "attention" }) },
          { key: "clean", label: `Ready (${counts.clean})`, href: href({ view: "clean" }) },
          { key: "done", label: `Handled (${counts.imported + counts.merged + counts.skipped})`, href: href({ view: "done" }) },
          { key: "all", label: `All (${counts.total})`, href: href({ view: "all" }) },
        ]}
      />
      {d.records.length ? (
        <div className="space-y-3">
          {d.records.map((r) => <RecordCard key={r.id} r={r} defaults={defaults} back={href({ page: d.page })} imageName={r.imageId ? imageNames[r.imageId] : undefined} />)}
        </div>
      ) : (
        <div className="card"><Empty>{counts.total ? "No rows in this view." : batch.kind === "SCREENSHOT" ? (provider.configured ? "No rows yet — images are being read, or no businesses were found." : "No rows yet. Add leads from each screenshot by hand above.") : "This CSV had no rows."}</Empty></div>
      )}
      {d.pages > 1 && (
        <nav className="flex items-center gap-2 text-sm" aria-label="Pages">
          {d.page > 1 && <Link className="btn-secondary btn-sm" href={href({ page: d.page - 1 })}>Previous</Link>}
          <span className="text-muted">Page {d.page} of {d.pages} · {d.filteredCount} row(s)</span>
          {d.page < d.pages && <Link className="btn-secondary btn-sm" href={href({ page: d.page + 1 })}>Next</Link>}
        </nav>
      )}
    </div>
  );
}
