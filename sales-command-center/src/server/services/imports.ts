import Papa from "papaparse";
import { Prisma, type ImportRecord, type ImportRecordStatus } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { assertCan, type Actor } from "../policy";
import { AppError, conflict, invalid, notFound } from "../errors";
import { readStored, saveUpload, type StoredFile } from "../storage";
import { getExtractionProvider } from "../extraction";
import { checkDuplicates, createLead, updateLead } from "./leads";
import { IMPORT_FIELDS, applyMapping, autoMapHeaders, hasBlockingFlag, isClean, reviewFlags, type ImportConfidence, type ImportField, type ImportValues } from "@/lib/domain/imports";
import { normalizeBusinessName, normalizePhone } from "@/lib/normalize";

const MAX_IMAGES = 30;
const MAX_CSV_ROWS = 5000;

const can = (actor: Actor) => assertCan(actor, "lead.import", "Only the coordinator can import leads.");

/** Current values of a record: the reviewer's edits on top of what was extracted. */
export function recordValues(r: Pick<ImportRecord, "extracted" | "edited">): ImportValues {
  return { ...((r.extracted as ImportValues) ?? {}), ...((r.edited as ImportValues) ?? {}) };
}

// ---------- create batches ----------

export async function createScreenshotBatch(actor: Actor, files: File[], notes?: string | null) {
  can(actor);
  const list = files.filter((f) => f && f.size > 0);
  if (!list.length) throw invalid("Choose at least one screenshot.");
  if (list.length > MAX_IMAGES) throw invalid(`Upload at most ${MAX_IMAGES} screenshots at a time.`);
  const provider = getExtractionProvider();
  const stored: StoredFile[] = [];
  for (const f of list) stored.push(await saveUpload(f, "imports", { imagesOnly: true, maxBytes: 15 * 1024 * 1024 }));
  const seen = new Set<string>();
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({ data: { kind: "SCREENSHOT", createdById: actor.id, provider: provider?.label ?? null, notes: notes ?? null } });
    for (const s of stored) {
      const dupInBatch = seen.has(s.sha256);
      seen.add(s.sha256);
      const earlier = await tx.importImage.findFirst({ where: { sha256: s.sha256, batchId: { not: batch.id } }, select: { batchId: true } });
      await tx.importImage.create({
        data: {
          batchId: batch.id,
          fileName: s.name,
          mimeType: s.mime,
          sizeBytes: s.size,
          sha256: s.sha256,
          path: s.path,
          status: dupInBatch ? "DUPLICATE" : provider ? "UPLOADED" : "NOT_CONFIGURED",
          error: dupInBatch ? "Same image appears twice in this upload — skipped." : earlier ? "This exact image was uploaded in an earlier import. Check for duplicates before importing." : null,
        },
      });
    }
    await audit(tx, actor, "import.created", { type: "ImportBatch", id: batch.id }, `Screenshot import started: ${stored.length} image(s)${provider ? "" : " — no extraction provider configured"}`);
    return batch;
  });
}

/** Read one uploaded screenshot with the configured provider. Raw text and per-field confidence are stored as returned. */
export async function extractImage(actor: Actor, imageId: string) {
  can(actor);
  const img = await prisma.importImage.findUnique({ where: { id: imageId } });
  if (!img) throw notFound("Image");
  if (!["UPLOADED", "ERROR", "NOT_CONFIGURED"].includes(img.status)) return { status: img.status, count: 0 };
  const provider = getExtractionProvider();
  if (!provider) {
    await prisma.importImage.update({ where: { id: img.id }, data: { status: "NOT_CONFIGURED", error: null } });
    return { status: "NOT_CONFIGURED", count: 0 };
  }
  const claimed = await prisma.importImage.updateMany({ where: { id: img.id, status: img.status }, data: { status: "EXTRACTING", error: null } });
  if (!claimed.count) return { status: "EXTRACTING", count: 0 };
  try {
    const result = await provider.extract({ data: await readStored(img.path), mime: img.mimeType, fileName: img.fileName });
    await prisma.$transaction(async (tx) => {
      await tx.importRecord.deleteMany({ where: { imageId: img.id, status: "PENDING" } });
      const base = await tx.importRecord.count({ where: { batchId: img.batchId } });
      let n = 0;
      for (const l of result.leads) {
        await tx.importRecord.create({
          data: { batchId: img.batchId, imageId: img.id, rowNumber: base + ++n, extracted: l.values as Prisma.InputJsonValue, confidence: l.confidence as Prisma.InputJsonValue, sourceText: l.sourceText },
        });
      }
      await tx.importImage.update({ where: { id: img.id }, data: { status: "EXTRACTED", rawText: result.rawText, error: result.leads.length ? null : "No businesses were found in this image." } });
      await tx.importBatch.update({ where: { id: img.batchId }, data: { provider: provider.label } });
    });
    return { status: "EXTRACTED", count: result.leads.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Extraction failed";
    await prisma.importImage.update({ where: { id: img.id }, data: { status: "ERROR", error: message.slice(0, 1000) } });
    return { status: "ERROR", count: 0, error: message };
  }
}

export async function requeueImage(actor: Actor, imageId: string) {
  can(actor);
  if (!getExtractionProvider()) throw invalid("No extraction provider is configured.");
  const res = await prisma.importImage.updateMany({ where: { id: imageId, status: { in: ["ERROR", "NOT_CONFIGURED"] } }, data: { status: "UPLOADED", error: null } });
  if (!res.count) throw invalid("Only images that failed or weren't read can be read again.");
}

export async function createCsvBatch(actor: Actor, file: File) {
  can(actor);
  if (!file || file.size === 0) throw invalid("Choose a CSV file.");
  if (file.size > 5 * 1024 * 1024) throw invalid("CSV files must be under 5 MB.");
  const text = (await file.text()).replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  if (!headers.length) throw invalid("That file has no header row. The first row should name the columns (e.g. Business, Phone, Address).");
  if (parsed.data.length > MAX_CSV_ROWS) throw invalid(`CSV imports are limited to ${MAX_CSV_ROWS} rows at a time.`);
  if (!parsed.data.length) throw invalid("That CSV has a header row but no data rows.");
  const mapping = autoMapHeaders(headers);
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({ data: { kind: "CSV", createdById: actor.id, provider: "CSV", notes: JSON.stringify({ fileName: file.name.slice(0, 200), headers, mapping }) } });
    await tx.importRecord.createMany({
      data: parsed.data.map((row, i) => ({ batchId: batch.id, rowNumber: i + 1, sourceText: JSON.stringify(row), extracted: applyMapping(row, mapping) as Prisma.InputJsonValue })),
    });
    await audit(tx, actor, "import.created", { type: "ImportBatch", id: batch.id }, `CSV import started: ${file.name} (${parsed.data.length} rows)`);
    return batch;
  });
}

export function csvMeta(batch: { kind: string; notes: string | null }): { fileName: string; headers: string[]; mapping: Record<string, ImportField | ""> } | null {
  if (batch.kind !== "CSV" || !batch.notes) return null;
  try {
    return JSON.parse(batch.notes);
  } catch {
    return null;
  }
}

/** Change the column mapping of a CSV import; re-applies to rows that haven't been decided (keeps reviewer edits). */
export async function remapCsv(actor: Actor, batchId: string, mapping: Record<string, string>) {
  can(actor);
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  const meta = batch && csvMeta(batch);
  if (!batch || !meta) throw notFound("CSV import");
  const clean: Record<string, ImportField | ""> = {};
  for (const h of meta.headers) {
    const f = mapping[h];
    clean[h] = f && (IMPORT_FIELDS as readonly string[]).includes(f) ? (f as ImportField) : "";
  }
  if (!Object.values(clean).includes("businessName")) throw invalid("Map one column to Business name.");
  const rows = await prisma.importRecord.findMany({ where: { batchId, status: "PENDING" } });
  await prisma.$transaction(async (tx) => {
    for (const r of rows) await tx.importRecord.update({ where: { id: r.id }, data: { extracted: applyMapping(JSON.parse(r.sourceText ?? "{}"), clean) as Prisma.InputJsonValue } });
    await tx.importBatch.update({ where: { id: batchId }, data: { notes: JSON.stringify({ ...meta, mapping: clean }) } });
  });
}

// ---------- review ----------

export type ReviewView = "pending" | "attention" | "clean" | "done" | "all";

/**
 * Batch with every row's flags. Duplicate lookups against existing leads run only for the rows on
 * the requested page (and again at import time), so large CSV files stay fast.
 */
export async function getBatchForReview(actor: Actor, batchId: string, opts: { view?: ReviewView; page?: number; pageSize?: number } = {}) {
  can(actor);
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { createdBy: { select: { name: true } }, images: { orderBy: { createdAt: "asc" } }, records: { orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }], include: { lead: { select: { id: true, businessName: true, leadNumber: true } } } } },
  });
  if (!batch) throw notFound("Import");
  const keyCount = new Map<string, number>();
  const keys = (v: ImportValues) => [v.businessName ? "n:" + normalizeBusinessName(v.businessName) : "", normalizePhone(v.phone).length >= 7 ? "p:" + normalizePhone(v.phone) : ""].filter(Boolean);
  for (const r of batch.records) if (r.status === "PENDING") for (const k of keys(recordValues(r))) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  const all = batch.records.map((r) => {
    const values = recordValues(r);
    const flags = reviewFlags(values, r.confidence as ImportConfidence | null);
    if (r.status === "PENDING" && keys(values).some((k) => (keyCount.get(k) ?? 0) > 1)) flags.push({ level: "warn", message: "Another row in this import looks like the same business" });
    if (r.status === "PENDING" && r.error) flags.push({ level: "warn", message: r.error });
    return { ...r, values, flags, clean: r.status === "PENDING" && isClean(flags) && !flags.some((f) => f.message.startsWith("Another row")) && !r.error };
  });
  // Check against existing leads up front for normal-sized imports so "Ready" means ready; very large CSVs are checked per page.
  const pendingRows = all.filter((r) => r.status === "PENDING" && r.values.businessName);
  const fullCheck = pendingRows.length <= 300;
  const dupMap = new Map<string, Awaited<ReturnType<typeof checkDuplicates>>>();
  const lookup = async (r: (typeof all)[number]) => {
    if (!dupMap.has(r.id)) dupMap.set(r.id, r.status === "PENDING" && r.values.businessName ? (await checkDuplicates(r.values)).slice(0, 3) : []);
    return dupMap.get(r.id)!;
  };
  if (fullCheck) for (const r of pendingRows) if ((await lookup(r)).length) r.clean = false;
  const view = opts.view ?? "pending";
  const filtered = all.filter((r) => (view === "all" ? true : view === "done" ? r.status !== "PENDING" : view === "pending" ? r.status === "PENDING" : view === "clean" ? r.clean : r.status === "PENDING" && !r.clean));
  const pageSize = opts.pageSize ?? 50;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  const records = await Promise.all(slice.map(async (r) => ({ ...r, duplicates: await lookup(r) })));
  const count = (s: ImportRecordStatus) => batch.records.filter((r) => r.status === s).length;
  return {
    batch,
    records,
    all,
    view,
    page,
    pages,
    fullCheck,
    filteredCount: filtered.length,
    counts: { total: batch.records.length, pending: count("PENDING"), clean: all.filter((r) => r.clean).length, imported: count("IMPORTED"), merged: count("MERGED"), skipped: count("SKIPPED"), error: count("ERROR") },
    imageCounts: {
      total: batch.images.length,
      extracted: batch.images.filter((i) => i.status === "EXTRACTED").length,
      waiting: batch.images.filter((i) => ["UPLOADED", "EXTRACTING"].includes(i.status)).length,
      failed: batch.images.filter((i) => i.status === "ERROR").length,
      notConfigured: batch.images.filter((i) => i.status === "NOT_CONFIGURED").length,
    },
  };
}

function cleanEdits(raw: Record<string, unknown>): ImportValues {
  const out: ImportValues = {};
  for (const f of IMPORT_FIELDS) {
    if (!(f in raw)) continue;
    const v = raw[f];
    out[f] = typeof v === "string" && v.trim() ? v.replace(/\u0000/g, "").slice(0, f === "notes" ? 10000 : 300) : null;
    if (f !== "notes" && out[f]) out[f] = out[f]!.trim();
  }
  return out;
}

async function pendingRecord(id: string) {
  const r = await prisma.importRecord.findUnique({ where: { id } });
  if (!r) throw notFound("Import row");
  if (r.status !== "PENDING") throw conflict("This row was already handled.");
  return r;
}

/** Save the reviewer's corrections. The extracted values are kept unchanged alongside. */
export async function saveRecordEdits(actor: Actor, recordId: string, raw: Record<string, unknown>) {
  can(actor);
  const r = await pendingRecord(recordId);
  const edits = cleanEdits(raw);
  const extracted = (r.extracted as ImportValues) ?? {};
  const changed = Object.fromEntries(Object.entries(edits).filter(([k, v]) => (extracted[k as ImportField] ?? null) !== v));
  await prisma.importRecord.update({ where: { id: r.id }, data: { edited: Object.keys(changed).length ? (changed as Prisma.InputJsonValue) : Prisma.DbNull } });
}

/** Add a row typed in by the reviewer (e.g. when no extraction provider is configured). */
export async function addManualRecord(actor: Actor, batchId: string, imageId: string | null, raw: Record<string, unknown>) {
  can(actor);
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound("Import");
  const values = cleanEdits(raw);
  if (!values.businessName) throw invalid("Business name is required.");
  const n = await prisma.importRecord.count({ where: { batchId } });
  return prisma.importRecord.create({ data: { batchId, imageId: imageId || null, rowNumber: n + 1, extracted: {}, edited: values as Prisma.InputJsonValue, sourceText: "Entered manually by the reviewer" } });
}

export interface ImportDefaults {
  assignedRepId?: string | null;
  areaId?: string | null;
  source?: string | null;
}

function sourceLabel(kind: string, defaults: ImportDefaults) {
  return defaults.source || (kind === "CSV" ? "CSV import" : "Screenshot import");
}

/** Create a new lead from a row. A suspected duplicate is refused unless `allowDuplicate` (an explicit reviewer choice). */
export async function importAsNew(actor: Actor, recordId: string, defaults: ImportDefaults = {}, allowDuplicate = false) {
  can(actor);
  const r = await pendingRecord(recordId);
  const v = recordValues(r);
  const flags = reviewFlags(v, r.confidence as ImportConfidence | null);
  if (hasBlockingFlag(flags)) throw invalid(flags.filter((f) => f.level === "error").map((f) => f.message).join(" · "));
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: r.batchId } });
  const lead = await createLead(
    actor,
    { businessName: v.businessName!, contactName: v.contactName, jobTitle: v.jobTitle, phone: v.phone, email: v.email, address: v.address, city: v.city, state: v.state, zip: v.zip, industry: v.industry, notes: v.notes, source: sourceLabel(batch.kind, defaults), assignedRepId: defaults.assignedRepId || null, areaId: defaults.areaId || null },
    { allowDuplicate, source: `${batch.kind === "CSV" ? "CSV" : "screenshot"} import` },
  );
  const res = await prisma.importRecord.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "IMPORTED", leadId: lead.id, error: null } });
  if (!res.count) throw conflict("This row was handled by someone else at the same time.");
  return lead;
}

/**
 * Merge a row into an existing lead: fills only fields that are empty on the lead (never overwrites),
 * and appends the row's notes verbatim under a dated heading. Returns which fields were filled.
 */
export async function mergeInto(actor: Actor, recordId: string, leadId: string) {
  can(actor);
  const r = await pendingRecord(recordId);
  const v = recordValues(r);
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw notFound("Lead");
  const patch: Record<string, string> = {};
  const skipped: string[] = [];
  for (const f of ["contactName", "jobTitle", "phone", "email", "address", "city", "state", "zip", "industry"] as const) {
    const incoming = v[f];
    if (!incoming) continue;
    if (!lead[f]) patch[f] = incoming;
    else if (lead[f]!.trim().toLowerCase() !== incoming.trim().toLowerCase()) skipped.push(f);
  }
  if (v.notes) patch.notes = lead.notes ? `${lead.notes}\n\n— Imported ${new Date().toISOString().slice(0, 10)} —\n${v.notes}` : v.notes;
  if (Object.keys(patch).length) await updateLead(actor, lead.id, patch, lead.version);
  await prisma.$transaction(async (tx) => {
    const res = await tx.importRecord.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "MERGED", leadId: lead.id, error: skipped.length ? `Kept the lead's existing ${skipped.join(", ")} (import had different values)` : null } });
    if (!res.count) throw conflict("This row was handled by someone else at the same time.");
    await audit(tx, actor, "import.merged", { type: "Lead", id: lead.id, leadId: lead.id }, `Merged import row into this lead${Object.keys(patch).length ? ` (filled ${Object.keys(patch).join(", ")})` : " (no new information)"}`);
  });
  return { filled: Object.keys(patch), kept: skipped };
}

export async function skipRecords(actor: Actor, recordIds: string[]) {
  can(actor);
  const res = await prisma.importRecord.updateMany({ where: { id: { in: recordIds }, status: "PENDING" }, data: { status: "SKIPPED" } });
  return res.count;
}

export async function restoreRecord(actor: Actor, recordId: string) {
  can(actor);
  const res = await prisma.importRecord.updateMany({ where: { id: recordId, status: "SKIPPED" }, data: { status: "PENDING" } });
  if (!res.count) throw invalid("Only skipped rows can be restored.");
}

/**
 * Import every clean row (no errors, no low-confidence values, no in-batch twin). A row that turns
 * out to match an existing lead is not created — it stays pending with the match noted for review.
 */
export async function importCleanRows(actor: Actor, batchId: string, defaults: ImportDefaults = {}) {
  can(actor);
  const { all } = await getBatchForReview(actor, batchId, { pageSize: 1 });
  const out = { imported: 0, duplicates: 0, failed: 0, left: 0, errors: [] as string[] };
  for (const r of all) {
    if (r.status !== "PENDING") continue;
    if (!r.clean) {
      out.left++;
      continue;
    }
    try {
      await importAsNew(actor, r.id, defaults, false);
      out.imported++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "failed";
      if (e instanceof AppError && e.code === "CONFLICT") {
        out.duplicates++;
        out.left++;
      } else {
        out.failed++;
        out.errors.push(`Row ${r.rowNumber ?? "?"}: ${msg}`);
      }
      await prisma.importRecord.update({ where: { id: r.id }, data: { error: msg.slice(0, 500) } });
    }
  }
  await maybeComplete(batchId);
  await prisma.auditLog.create({ data: { actorId: actor.id, action: "import.bulk", entityType: "ImportBatch", entityId: batchId, summary: `Imported ${out.imported} clean row(s); ${out.left} left for review (${out.duplicates} possible duplicate(s)); ${out.failed} failed` } });
  return out;
}

export async function maybeComplete(batchId: string) {
  const pending = await prisma.importRecord.count({ where: { batchId, status: "PENDING" } });
  const waiting = await prisma.importImage.count({ where: { batchId, status: { in: ["UPLOADED", "EXTRACTING"] } } });
  await prisma.importBatch.update({ where: { id: batchId }, data: { completedAt: pending || waiting ? null : new Date() } });
}

export async function listBatches(actor: Actor) {
  can(actor);
  const batches = await prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { createdBy: { select: { name: true } }, _count: { select: { images: true, records: true } } } });
  const grouped = await prisma.importRecord.groupBy({ by: ["batchId", "status"], where: { batchId: { in: batches.map((b) => b.id) } }, _count: true });
  return batches.map((b) => ({ ...b, statusCounts: Object.fromEntries(grouped.filter((g) => g.batchId === b.id).map((g) => [g.status, g._count])) as Partial<Record<ImportRecordStatus, number>> }));
}

export async function getImageForFile(actor: Actor, imageId: string) {
  can(actor);
  const img = await prisma.importImage.findUnique({ where: { id: imageId } });
  if (!img) throw notFound("Image");
  return img;
}
