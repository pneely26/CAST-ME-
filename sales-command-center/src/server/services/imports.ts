import Papa from "papaparse";
import { Prisma, type ImportRecord, type ImportRecordStatus } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { assertCan, type Actor } from "../policy";
import { AppError, conflict, invalid, notFound } from "../errors";
import { readStored, saveUpload, type StoredFile } from "../storage";
import { getExtractionProvider } from "../extraction";
import { checkDuplicates, createLead, updateLead } from "./leads";
import { notify } from "./notifications";
import { refreshLeadRollups } from "./rollups";
import { getSettings } from "../settings";
import type { Tx } from "../db";
import { cityKey, likelyCityTypo } from "@/lib/domain/imports";
import { IMPORT_FIELDS, applyMapping, autoMapHeaders, detectPreset, hasBlockingFlag, isClean, normalizePersonName, parseApptStatus, parseLooseDate, parseLooseTime, reviewFlags, unmappedDetails, type ImportConfidence, type ImportField, type ImportValues } from "@/lib/domain/imports";
import { advanceStatus } from "@/lib/domain/rollups";
import { dateKeyInTz, dayRangeUtc, fmtDateKey, fmtClock, zonedToUtc } from "@/lib/time";
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
    const batch = await tx.importBatch.create({ data: { kind: "CSV", createdById: actor.id, provider: "CSV", notes: JSON.stringify({ fileName: file.name.slice(0, 200), headers, mapping, preset: detectPreset(headers) }) } });
    await tx.importRecord.createMany({
      data: parsed.data.map((row, i) => ({ batchId: batch.id, rowNumber: i + 1, sourceText: JSON.stringify(row), extracted: applyMapping(row, mapping) as Prisma.InputJsonValue })),
    });
    await audit(tx, actor, "import.created", { type: "ImportBatch", id: batch.id }, `CSV import started: ${file.name} (${parsed.data.length} rows)`);
    return batch;
  });
}

export function csvMeta(batch: { kind: string; notes: string | null }): { fileName: string; headers: string[]; mapping: Record<string, ImportField | "">; preset?: string | null } | null {
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
  const meta = csvMeta(batch);
  const reps = await activeReps();
  const todayKey = dateKeyInTz(new Date(), (await getSettings()).timezone);
  const pending = batch.records.filter((r) => r.status === "PENDING");
  // rows that share a prospect / account # are the same business: the first creates the lead, the rest add to it
  const groupLeader = new Map<string, number>();
  for (const r of batch.records) {
    const x = recordValues(r).externalId;
    if (x && !groupLeader.has(x)) groupLeader.set(x, r.rowNumber ?? 0);
  }
  const extIds = [...new Set(pending.map((r) => recordValues(r).externalId).filter((x): x is string => !!x))];
  const existingByExt = new Map(
    (extIds.length ? await prisma.lead.findMany({ where: { externalId: { in: extIds } }, select: { id: true, leadNumber: true, businessName: true, externalId: true } }) : []).map((l) => [l.externalId!, l]),
  );
  // city spellings: every city in this file plus existing areas (an existing area counts as well established)
  const cityCounts = new Map<string, { name: string; count: number }>();
  for (const a of await prisma.area.findMany({ where: { archivedAt: null }, select: { name: true } })) cityCounts.set(cityKey(a.name), { name: a.name, count: 1000 });
  for (const r of batch.records) {
    const c = recordValues(r).city;
    if (!c?.trim()) continue;
    const e = cityCounts.get(cityKey(c)) ?? { name: titleCase(c), count: 0 };
    e.count++;
    cityCounts.set(cityKey(c), e);
  }
  const keyCount = new Map<string, number>();
  const keys = (v: ImportValues) => (v.externalId ? [] : [v.businessName ? "n:" + normalizeBusinessName(v.businessName) : "", normalizePhone(v.phone).length >= 7 ? "p:" + normalizePhone(v.phone) : ""].filter(Boolean));
  for (const r of pending) for (const k of keys(recordValues(r))) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  const all = batch.records.map((r) => {
    const values = recordValues(r);
    const flags = reviewFlags(values, r.confidence as ImportConfidence | null);
    const idMatch = values.externalId ? (existingByExt.get(values.externalId) ?? null) : null;
    const leaderRow = values.externalId ? groupLeader.get(values.externalId) : undefined;
    const follower = !!values.externalId && !idMatch && leaderRow !== undefined && leaderRow !== (r.rowNumber ?? 0);
    const rep = matchRep(values.repName, reps);
    if (r.status === "PENDING") {
      if (idMatch) flags.push({ level: "info", message: `Same prospect # as existing lead #${idMatch.leadNumber} ${idMatch.businessName} — it will be updated (empty fields filled, appointment added), not duplicated` });
      else if (follower) flags.push({ level: "info", message: `Same prospect # as row ${leaderRow} — added to the same lead, not created twice` });
      if (values.repName && !rep) flags.push({ field: "repName", level: "info", message: `“${values.repName}” isn't a sales rep login in this app — the lead gets the default rep chosen below. Add them in Settings → Users to match automatically.` });
      if (keys(values).some((k) => (keyCount.get(k) ?? 0) > 1)) flags.push({ level: "warn", message: "Another row in this import looks like the same business" });
      if (r.error) flags.push({ level: "warn", message: r.error });
      const typo = likelyCityTypo(values.city, cityCounts);
      if (typo) flags.push({ field: "city", level: "warn", message: `“${values.city}” looks like a misspelling of “${typo}” — fix the city (or leave it if it's right), then import this row` });
      const day = parseLooseDate(values.appointmentDate);
      const st = parseApptStatus(values.appointmentStatus);
      if (day && day < todayKey && st !== "CANCELED" && st !== "NO_SHOW") flags.push({ field: "appointmentDate", level: "info", message: "Past appointment — imported as held (Completed) and counted as a visit" });
    }
    const details = meta && r.sourceText ? unmappedDetails(JSON.parse(r.sourceText), meta.mapping) : {};
    return { ...r, values, flags, details, idMatch, follower, rep, clean: r.status === "PENDING" && isClean(flags) && !flags.some((f) => f.message.startsWith("Another row")) && !r.error };
  });
  // Check against existing leads up front for normal-sized imports so "Ready" means ready; very large files are checked per page.
  const pendingRows = all.filter((r) => r.status === "PENDING" && r.values.businessName && !r.idMatch && !r.follower);
  const fullCheck = pendingRows.length <= 1000;
  const dupMap = new Map<string, Awaited<ReturnType<typeof checkDuplicates>>>();
  const lookup = async (r: (typeof all)[number]) => {
    if (!dupMap.has(r.id)) dupMap.set(r.id, r.status === "PENDING" && r.values.businessName && !r.idMatch && !r.follower ? (await checkDuplicates(r.values)).slice(0, 3) : []);
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

/** Area choice for an import: an area id, "city" (each lead goes to the area named after its city), or "none". */
export const AREA_BY_CITY = "city";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida",
  GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

const titleCase = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s\-'.])([a-z])/g, (_, p, c) => p + c.toUpperCase());

/**
 * Area for a lead's city: an existing area with that name (any capitalization) is reused — preferring one in the
 * territory for the lead's state — otherwise an area named after the city is created in a territory named after
 * the state (e.g. "Lexington" in "Kentucky"). No city → no area.
 */
export async function areaForCity(actor: Actor, city: string | null | undefined, state: string | null | undefined): Promise<{ areaId: string; territoryId: string } | null> {
  if (!city?.trim()) return null;
  const name = titleCase(city);
  const code = (state ?? "").trim().toUpperCase();
  const territoryName = STATE_NAMES[code] ?? (code ? code : "No state");
  const existing = await prisma.area.findMany({ where: { name: { equals: name, mode: "insensitive" }, archivedAt: null, territory: { archivedAt: null } }, include: { territory: { select: { name: true } } } });
  const pick = existing.find((a) => a.territory.name.toLowerCase() === territoryName.toLowerCase()) ?? (existing.length === 1 ? existing[0] : null);
  if (pick) return { areaId: pick.id, territoryId: pick.territoryId };
  return prisma.$transaction(async (tx) => {
    let territory = await tx.territory.findFirst({ where: { name: { equals: territoryName, mode: "insensitive" } } });
    if (!territory) {
      territory = await tx.territory.create({ data: { name: territoryName } });
      await audit(tx, actor, "territory.created", { type: "Territory", id: territory.id }, `Created territory ${territory.name} (from an import)`);
    } else if (territory.archivedAt) {
      territory = await tx.territory.update({ where: { id: territory.id }, data: { archivedAt: null } });
      await audit(tx, actor, "territory.restored", { type: "Territory", id: territory.id }, `Restored territory ${territory.name} (an import placed leads in it)`);
    }
    let area = await tx.area.findFirst({ where: { territoryId: territory.id, name: { equals: name, mode: "insensitive" } } });
    if (!area) {
      area = await tx.area.create({ data: { territoryId: territory.id, name } });
      await audit(tx, actor, "area.created", { type: "Area", id: area.id }, `Created area ${name} in ${territory.name} (from an import)`);
    } else if (area.archivedAt) {
      area = await tx.area.update({ where: { id: area.id }, data: { archivedAt: null } });
      await audit(tx, actor, "area.restored", { type: "Area", id: area.id }, `Restored area ${area.name} (an import placed leads in it)`);
    }
    return { areaId: area.id, territoryId: territory.id };
  });
}

async function resolveArea(actor: Actor, defaults: ImportDefaults, v: ImportValues): Promise<string | null> {
  if (!defaults.areaId || defaults.areaId === "none") return null;
  if (defaults.areaId === AREA_BY_CITY) return (await areaForCity(actor, v.city, v.state))?.areaId ?? null;
  return defaults.areaId;
}

function sourceLabel(kind: string, defaults: ImportDefaults) {
  return defaults.source || (kind === "CSV" ? "CSV import" : "Screenshot import");
}

type RepLite = { id: string; name: string };

async function activeReps(): Promise<RepLite[]> {
  return prisma.user.findMany({ where: { role: "REP", active: true }, select: { id: true, name: true } });
}

/** Match a rep name from a file ("Mozzano, Louis" or "Louis Mozzano") to an active rep login. Exact name only — never guessed. */
function matchRep(name: string | null | undefined, reps: RepLite[]): RepLite | null {
  const n = normalizePersonName(name);
  if (!n) return null;
  const hits = reps.filter((r) => normalizePersonName(r.name) === n);
  return hits.length === 1 ? hits[0] : null;
}

const leadFields = (v: ImportValues) => ({
  businessName: v.businessName!,
  contactName: v.contactName,
  jobTitle: v.jobTitle,
  phone: v.phone,
  email: v.email,
  address: v.address,
  city: v.city,
  state: v.state,
  zip: v.zip,
  industry: v.industry,
  notes: v.notes,
  externalId: v.externalId,
  employeeCount: v.employeeCount ? v.employeeCount.replace(/[,\s]/g, "") : null,
});

function rowDetails(r: { sourceText: string | null }, batch: { kind: string; notes: string | null }): Record<string, string> | null {
  const meta = csvMeta(batch);
  if (!meta || !r.sourceText) return null;
  const d = unmappedDetails(JSON.parse(r.sourceText), meta.mapping);
  return Object.keys(d).length ? d : null;
}

/**
 * Add the row's appointment to a lead. Imported appointments keep the file's date (and time, if it has one;
 * otherwise the time is "not set"). Skips if the lead already has an appointment that day.
 * - Past dates are appointments that were held: marked Completed and recorded as a visit
 *   (outcome "Other", no feedback invented), unless the file says canceled / no-show.
 * - Today and later: the file's status (Confirmed / Scheduled).
 * No notifications: these are records from another system, not new bookings.
 */
async function addImportedAppointment(tx: Tx, actor: Actor, leadId: string, repId: string | null, v: ImportValues, label: string): Promise<string | null> {
  const day = parseLooseDate(v.appointmentDate);
  if (!day) return null;
  const settings = await getSettings(tx);
  const tz = settings.timezone;
  const when = `${fmtDateKey(day)}${v.appointmentTime ? ` ${fmtClock(parseLooseTime(v.appointmentTime))}` : ""}`;
  if (!repId) return `Appointment on ${when} not added — no sales rep (choose a default rep and import again)`;
  const { start, end } = dayRangeUtc(day, day, tz);
  if (await tx.appointment.findFirst({ where: { leadId, startAt: { gte: start, lt: end } }, select: { id: true } })) return `Appointment on ${when} was already on this lead`;
  const time = parseLooseTime(v.appointmentTime);
  const startAt = time ? zonedToUtc(day, time, tz) : start;
  const endAt = time ? new Date(startAt.getTime() + settings.defaultAppointmentMinutes * 60_000) : end;
  const fileStatus = parseApptStatus(v.appointmentStatus) ?? "SCHEDULED";
  const past = day < dateKeyInTz(new Date(), tz);
  const status = past && !["CANCELED", "NO_SHOW"].includes(fileStatus) ? "COMPLETED" : fileStatus;
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  const appt = await tx.appointment.create({
    data: { leadId, repId, startAt, endAt, timeSet: !!time, status, location: [lead.address, lead.city].filter(Boolean).join(", ") || null, notes: `Imported from ${label}`, createdById: actor.id, ...(status === "CANCELED" ? { canceledAt: new Date() } : {}) },
  });
  await tx.appointmentChange.create({ data: { appointmentId: appt.id, action: "CREATED", toStart: startAt, toEnd: endAt, changedById: actor.id, reason: `Imported from ${label}` } });
  await audit(tx, actor, "appointment.imported", { type: "Appointment", id: appt.id, leadId }, `Appointment on ${when}${time ? "" : " (time not set)"} imported from ${label} — ${status === "COMPLETED" ? "held (past), recorded as a visit" : `status ${status.toLowerCase().replace("_", " ")}`}`);
  if (status === "COMPLETED") {
    await tx.appointmentChange.create({ data: { appointmentId: appt.id, action: "COMPLETED", fromStart: startAt, fromEnd: endAt, changedById: actor.id, reason: `Past appointment imported from ${label}` } });
    await tx.visit.create({
      data: { leadId, repId, visitAt: startAt, timeSet: !!time, type: "SCHEDULED_APPOINTMENT", outcome: "OTHER", appointmentId: appt.id, notes: `Appointment held — imported from ${label}. The file doesn't record what happened at the appointment.` },
    });
  }
  // move the lead along like a booking or visit would (closed statuses are never changed)
  const target = status === "COMPLETED" ? "VISITED" : ["SCHEDULED", "CONFIRMED"].includes(status) && !past ? "APPOINTMENT_SCHEDULED" : null;
  const next = target ? advanceStatus(lead.status, target) : lead.status;
  if (next !== lead.status) await tx.lead.update({ where: { id: leadId }, data: { status: next, version: { increment: 1 } } });
  await refreshLeadRollups(tx, leadId);
  return `Appointment added: ${when}${time ? "" : " (time not set)"}, ${status === "COMPLETED" ? "held — counted as a visit" : status.toLowerCase().replace("_", " ")}`;
}

async function batchLabel(batchId: string) {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  return { batch, label: csvMeta(batch)?.fileName ?? (batch.kind === "CSV" ? "CSV import" : "screenshot import") };
}

/**
 * Create a new lead from a row. A suspected duplicate (similar name/phone/address) is refused unless
 * `allowDuplicate` (an explicit reviewer choice). A row whose prospect / account # already belongs to a
 * lead is added to that lead instead of creating a second one.
 */
export async function importAsNew(actor: Actor, recordId: string, defaults: ImportDefaults = {}, allowDuplicate = false, opts: { quiet?: boolean } = {}) {
  can(actor);
  const r = await pendingRecord(recordId);
  const v = recordValues(r);
  const flags = reviewFlags(v, r.confidence as ImportConfidence | null);
  if (hasBlockingFlag(flags)) throw invalid(flags.filter((f) => f.level === "error").map((f) => f.message).join(" · "));
  const { batch, label } = await batchLabel(r.batchId);
  if (v.externalId) {
    const existing = await prisma.lead.findUnique({ where: { externalId: v.externalId } });
    if (existing) {
      const m = await mergeInto(actor, recordId, existing.id, defaults);
      return { lead: existing, merged: true as const, note: m.note };
    }
  }
  const repId = matchRep(v.repName, await activeReps())?.id ?? defaults.assignedRepId ?? null;
  const lead = await createLead(
    actor,
    { ...leadFields(v), source: sourceLabel(batch.kind, defaults), assignedRepId: repId, areaId: await resolveArea(actor, defaults, v) },
    { allowDuplicate, source: `${batch.kind === "CSV" ? "CSV" : "screenshot"} import`, sourceDetails: rowDetails(r, batch), quiet: opts.quiet },
  );
  const note = await prisma.$transaction((tx) => addImportedAppointment(tx, actor, lead.id, repId, v, label));
  const res = await prisma.importRecord.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "IMPORTED", leadId: lead.id, error: note } });
  if (!res.count) throw conflict("This row was handled by someone else at the same time.");
  return { lead, merged: false as const, note };
}

/**
 * Merge a row into an existing lead: fills only fields that are empty on the lead (never overwrites),
 * appends the row's notes verbatim under a dated heading, adds file details the lead doesn't have yet,
 * and adds the row's appointment. Returns which fields were filled.
 */
export async function mergeInto(actor: Actor, recordId: string, leadId: string, defaults: ImportDefaults = {}) {
  can(actor);
  const r = await pendingRecord(recordId);
  const v = recordValues(r);
  const { batch, label } = await batchLabel(r.batchId);
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
  const fields = leadFields(v);
  if (fields.employeeCount && lead.employeeCount === null) patch.employeeCount = fields.employeeCount;
  if (v.externalId && !lead.externalId && !(await prisma.lead.findUnique({ where: { externalId: v.externalId } }))) patch.externalId = v.externalId;
  if (!lead.areaId && defaults.areaId === AREA_BY_CITY) {
    const area = await areaForCity(actor, v.city ?? lead.city, v.state ?? lead.state);
    if (area) patch.areaId = area.areaId;
  }
  if (v.notes) patch.notes = lead.notes ? `${lead.notes}\n\n— Imported ${new Date().toISOString().slice(0, 10)} —\n${v.notes}` : v.notes;
  if (Object.keys(patch).length) await updateLead(actor, lead.id, patch, lead.version);
  const incomingDetails = rowDetails(r, batch) ?? {};
  const current = (lead.sourceDetails as Record<string, string> | null) ?? {};
  const newDetails = Object.fromEntries(Object.entries(incomingDetails).filter(([k]) => !(k in current)));
  const repId = lead.assignedRepId ?? matchRep(v.repName, await activeReps())?.id ?? defaults.assignedRepId ?? null;
  const note = await prisma.$transaction(async (tx) => {
    if (Object.keys(newDetails).length) await tx.lead.update({ where: { id: lead.id }, data: { sourceDetails: { ...current, ...newDetails }, version: { increment: 1 } } });
    const apptNote = await addImportedAppointment(tx, actor, lead.id, repId, v, label);
    const kept = skipped.length ? `Kept the lead's existing ${skipped.join(", ")} (import had different values)` : null;
    const n = [apptNote, kept].filter(Boolean).join(" · ") || null;
    const res = await tx.importRecord.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "MERGED", leadId: lead.id, error: n } });
    if (!res.count) throw conflict("This row was handled by someone else at the same time.");
    const filled = [...Object.keys(patch), ...(Object.keys(newDetails).length ? ["file details"] : [])];
    await audit(tx, actor, "import.merged", { type: "Lead", id: lead.id, leadId: lead.id }, `Merged import row into this lead${filled.length ? ` (filled ${filled.join(", ")})` : " (no new information)"}${apptNote ? ` · ${apptNote}` : ""}`);
    return n;
  });
  return { filled: Object.keys(patch), kept: skipped, note };
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
 * Import every clean row (no errors, no low-confidence values, no unresolved twin). Rows with the same
 * prospect / account # become one lead with several appointments. A row that turns out to match an
 * existing lead by name/phone/address is not created — it stays pending with the match noted for review.
 * Reps get one summary notification instead of one per lead.
 */
export async function importCleanRows(actor: Actor, batchId: string, defaults: ImportDefaults = {}) {
  can(actor);
  const { all } = await getBatchForReview(actor, batchId, { pageSize: 1 });
  const out = { imported: 0, merged: 0, appointments: 0, duplicates: 0, failed: 0, left: 0, errors: [] as string[] };
  const assigned = new Map<string, number>();
  for (const r of all) {
    if (r.status !== "PENDING") continue;
    if (!r.clean) {
      out.left++;
      continue;
    }
    try {
      const res = await importAsNew(actor, r.id, defaults, false, { quiet: true });
      if (res.merged) out.merged++;
      else {
        out.imported++;
        if (res.lead.assignedRepId) assigned.set(res.lead.assignedRepId, (assigned.get(res.lead.assignedRepId) ?? 0) + 1);
      }
      if (res.note?.startsWith("Appointment added")) out.appointments++;
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
  if (assigned.size) {
    await prisma.$transaction(async (tx) => {
      for (const [repId, n] of assigned) await notify(tx, repId, { type: "LEAD_ASSIGNED", title: `${n} new lead${n === 1 ? "" : "s"} assigned to you from an import`, link: "/leads?view=mine", dedupeKey: `import-assign:${batchId}:${repId}:${Date.now()}` });
    });
  }
  await prisma.auditLog.create({ data: { actorId: actor.id, action: "import.bulk", entityType: "ImportBatch", entityId: batchId, summary: `Imported ${out.imported} new lead(s), updated ${out.merged} existing lead(s), added ${out.appointments} appointment(s); ${out.left} left for review (${out.duplicates} possible duplicate(s)); ${out.failed} failed` } });
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
