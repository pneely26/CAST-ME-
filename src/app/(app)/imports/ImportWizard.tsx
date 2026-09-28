"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { commitImportAction, parseUploadAction, previewImportAction, type ParsedUpload } from "@/app/actions/imports";
import type { PreviewResult } from "@/lib/server/imports";
import type { FieldDef } from "@/lib/import/mapping";

type Kind = "PUBLIC_BREAKDOWN" | "AGENCY_SUBMISSION";

const CLASS_LABEL: Record<string, string> = {
  PUBLIC_MATCH: "Public match",
  AGENCY_REPORTED_NOT_FOUND: "Not found publicly",
  NEEDS_REVIEW: "Needs review",
  POSSIBLE_DUPLICATE: "Possible duplicate",
};

export function ImportWizard({ kind, fields }: { kind: Kind; fields: FieldDef[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<ParsedUpload | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [source, setSource] = useState("");
  const [verified, setVerified] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [decisions, setDecisions] = useState<Record<number, string>>({});
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [done, setDone] = useState<{ saved: number; skipped: number; errors: string[] } | null>(null);

  const isPublic = kind === "PUBLIC_BREAKDOWN";
  const accept = isPublic ? ".csv,.xlsx,.json" : ".csv,.xlsx";

  function reset() {
    setUpload(null);
    setPreview(null);
    setDecisions({});
    setDone(null);
    setError(null);
    setConfirmOverwrite(false);
  }

  function onUpload(fd: FormData) {
    reset();
    fd.set("kind", kind);
    start(async () => {
      const r = await parseUploadAction(fd);
      if (!r.ok) return setError(r.error);
      setUpload(r);
      setMapping(r.mapping);
    });
  }

  function onPreview() {
    if (!upload) return;
    setError(null);
    start(async () => {
      const r = await previewImportAction(kind, upload.rows, mapping, source);
      if (!r.ok) return setError(r.error);
      setPreview(r.preview);
      setDecisions(Object.fromEntries(r.preview.rows.map((row) => [row.index, row.suggestedDecision])));
    });
  }

  function onCommit() {
    if (!upload || !preview) return;
    setError(null);
    start(async () => {
      const r = await commitImportAction(kind, upload.fileName, upload.rows, mapping, source, Object.fromEntries(Object.entries(decisions).map(([k, v]) => [k, v])), confirmOverwrite, verified);
      if (!r.ok) return setError(r.error);
      setDone(r);
      setPreview(null);
    });
  }

  const toImport = preview ? preview.rows.filter((r) => r.valid && decisions[r.index] && decisions[r.index] !== "skip").length : 0;
  const needsOverwriteConfirm = Object.values(decisions).some((d) => d.startsWith("update:"));

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      {done && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Imported <strong>{done.saved}</strong> row(s); skipped {done.skipped}.{" "}
          {isPublic ? <Link href="/opportunities" className="link">View opportunities</Link> : <Link href="/blind-spots" className="link">View blind-spot results</Link>}
          {done.errors.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-red-800">{done.errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="mt-2"><button className="btn-secondary" onClick={reset}>Import another file</button></div>
        </div>
      )}

      {/* Step 1 */}
      <form action={onUpload} className="card p-4">
        <h3 className="text-sm font-semibold">1 · Choose file</h3>
        <p className="mt-1 text-xs text-muted">
          {isPublic ? "CSV, XLSX or JSON (array of objects). Max 5 MB / 5,000 rows." : "CSV or XLSX exported from your agency’s report or your own tracking sheet. Max 5 MB / 5,000 rows."}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input type="file" name="file" accept={accept} required className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-sm" />
          <button className="btn-primary whitespace-nowrap" disabled={pending}>{pending && !upload ? "Reading…" : "Upload & read"}</button>
        </div>
      </form>

      {/* Step 2 */}
      {upload && !done && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold">2 · Map columns</h3>
          <p className="mt-1 text-xs text-muted">
            <strong>{upload.fileName}</strong> — {upload.rows.length} row(s), {upload.headers.length} column(s). Columns were matched automatically where possible; adjust as needed.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <label key={f.key} className="block">
                <span className="label">{f.label}{f.required && <span className="text-red-600"> *</span>}</span>
                <select className="input" value={mapping[f.key] ?? ""} onChange={(e) => { setMapping({ ...mapping, [f.key]: e.target.value || null }); setPreview(null); }}>
                  <option value="">— not in file —</option>
                  {upload.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          {isPublic && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Default source name (when the file has no Source column)</span>
                <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Public casting listing (manual export)" />
              </label>
              <label className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> I verified these listings at their source today
              </label>
            </div>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="table-base text-xs">
              <thead><tr>{upload.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{upload.rows.slice(0, 3).map((r, i) => <tr key={i}>{upload.headers.map((h) => <td key={h} className="max-w-[200px] truncate">{r[h]}</td>)}</tr>)}</tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">First 3 rows shown.</p>
          </div>
          <button className="btn-primary mt-4" onClick={onPreview} disabled={pending || !mapping.project}>{pending && !preview ? "Checking…" : "Preview import"}</button>
        </div>
      )}

      {/* Step 3 */}
      {preview && !done && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold">3 · Preview & confirm</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["Rows found", preview.rowsFound],
              ["Rows valid", preview.rowsValid],
              ["Rows invalid", preview.rowsInvalid],
              ["Duplicates", preview.duplicates],
              ["Potential matches", preview.potentialMatches],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-md border border-line px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">{l}</div>
                <div className="text-lg font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            {isPublic
              ? "Likely matches to existing projects are pre-set to “attach”. Uncertain ones default to “new project” — change them only if you’re sure. Duplicates are skipped unless you choose otherwise."
              : "Each submission will be compared with the public dataset after import. Duplicates are skipped by default."}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="table-base min-w-[760px]">
              <thead><tr><th>#</th><th>Row</th><th>Checks</th><th>Action</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.index} className={!r.valid ? "bg-red-50/50" : r.duplicate ? "bg-amber-50/50" : ""}>
                    <td className="text-muted">{r.index}</td>
                    <td className="max-w-xs">
                      <div className="font-medium">{r.summary.Project || <em className="text-muted">no project</em>}</div>
                      <div className="text-xs text-muted">{Object.entries(r.summary).filter(([k, v]) => k !== "Project" && v).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
                    </td>
                    <td className="max-w-sm text-xs">
                      {!r.valid && <ul className="text-red-700">{r.errors.map((e) => <li key={e}>✕ {e}</li>)}</ul>}
                      {r.duplicate && <div className="text-amber-800">⚠ {r.duplicate.label}</div>}
                      {r.classification && <div>Detection: <strong>{CLASS_LABEL[r.classification] ?? r.classification}</strong></div>}
                      {r.candidates.slice(0, 3).map((c) => (
                        <div key={c.projectId} className="text-ink-soft">
                          ↔ {c.title} — {c.verdict === "LIKELY_MATCH" ? "likely same" : "uncertain"} ({Math.round(c.score * 100)}%){c.conflicts.length ? `; ${c.conflicts.join(", ").toLowerCase()}` : ""}{c.agencyReported ? " · agency-reported" : ""}
                        </div>
                      ))}
                      {r.valid && !r.duplicate && r.candidates.length === 0 && <div className="text-muted">No similar records.</div>}
                    </td>
                    <td>
                      {r.valid ? (
                        <select className="input min-w-[190px] text-xs" value={decisions[r.index] ?? "skip"} onChange={(e) => setDecisions({ ...decisions, [r.index]: e.target.value })}>
                          {isPublic ? (
                            <>
                              <option value="new">Import as new project</option>
                              {r.candidates.map((c) => <option key={c.projectId} value={`attach:${c.projectId}`}>Attach to “{c.title}”</option>)}
                              {r.duplicate?.id && <option value={`update:${r.duplicate.id}`}>Overwrite existing record</option>}
                              <option value="skip">Skip</option>
                            </>
                          ) : (
                            <>
                              <option value="import">Import</option>
                              <option value="skip">Skip</option>
                            </>
                          )}
                        </select>
                      ) : (
                        <span className="text-xs text-muted">Skipped (invalid)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {needsOverwriteConfirm && (
            <label className="mt-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <input type="checkbox" checked={confirmOverwrite} onChange={(e) => setConfirmOverwrite(e.target.checked)} />
              I confirm overwriting existing records where I selected “Overwrite existing record”.
            </label>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={onCommit} disabled={pending || toImport === 0 || (needsOverwriteConfirm && !confirmOverwrite)}>
              {pending ? "Importing…" : `Import ${toImport} row(s)`}
            </button>
            <button className="btn-ghost" onClick={() => setPreview(null)} disabled={pending}>Back to mapping</button>
          </div>
        </div>
      )}
    </div>
  );
}
