import { Prisma, type ImportRecordStatus } from "@prisma/client";
import { prisma } from "../db";
import { audit, diff } from "../audit";
import { assertCan, type Actor } from "../policy";
import { invalid, notFound } from "../errors";
import { getSettings } from "../settings";
import { readPdfPages } from "../pdf";
import { changeLeadStatusInTx } from "./leads";
import { groupReportSales, parseSalesReport, reportPersonName, type ReportSale } from "@/lib/domain/salesReport";
import { zonedToUtc } from "@/lib/time";

/**
 * Importing sales from a "BC History" sales report (PDF).
 *
 * One sale per PN/Job #, attached to the lead with that prospect #. Every row is a sale (the report is a list
 * of sales); the Survey Result goes in GO status as printed, and RVOL / AVOL and the other columns are kept
 * verbatim on the sale. The report has no dollar amounts, so none are recorded: these sales count as closed
 * sales but add nothing to realized revenue. Re-importing a report updates the same sales — never duplicates.
 */

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const can = (actor: Actor) => assertCan(actor, "sales.editAll", "Only the coordinator can import sales.");

export interface SalesReportMeta {
  fileName: string;
  title: string | null;
  generatedOn: string | null;
  period: string | null;
  rowCount: number;
  problems: string[];
}

export function salesReportMeta(batch: { kind: string; notes: string | null }): SalesReportMeta | null {
  if (batch.kind !== "SALES_REPORT" || !batch.notes) return null;
  try {
    return JSON.parse(batch.notes);
  } catch {
    return null;
  }
}

export async function createSalesReportImport(actor: Actor, file: File) {
  can(actor);
  if (!file || file.size === 0) throw invalid("Choose the sales report PDF.");
  if (file.size > MAX_PDF_BYTES) throw invalid("Sales report PDFs must be under 15 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw invalid("That file isn't a PDF.");
  let pages;
  try {
    pages = await readPdfPages(bytes);
  } catch {
    throw invalid("That PDF couldn't be read. If it's password-protected or a scanned image, export the report again as a regular PDF.");
  }
  const parsed = parseSalesReport(pages);
  if (!parsed.rows.length) throw invalid(parsed.problems[0] ?? "No sales rows were found in that PDF.");
  const sales = groupReportSales(parsed.rows);
  const meta: SalesReportMeta = { fileName: file.name.slice(0, 200), title: parsed.title, generatedOn: parsed.generatedOn, period: parsed.period, rowCount: parsed.rows.length, problems: parsed.problems.slice(0, 50) };
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({ data: { kind: "SALES_REPORT", createdById: actor.id, provider: "PDF", notes: JSON.stringify(meta) } });
    await tx.importRecord.createMany({
      data: sales.map((s) => ({
        batchId: batch.id,
        rowNumber: s.rowNumbers[0],
        extracted: s as unknown as Prisma.InputJsonValue,
        sourceText: JSON.stringify(parsed.rows.filter((r) => s.rowNumbers.includes(r.rowNumber))),
      })),
    });
    await audit(tx, actor, "import.created", { type: "ImportBatch", id: batch.id }, `Sales report import started: ${meta.fileName} (${parsed.rows.length} rows, ${sales.length} sales)`);
    return batch;
  });
}

export type SalePlanAction = "create" | "update" | "unchanged" | "blocked" | "done";
export interface SalePlan {
  recordId: string;
  status: ImportRecordStatus;
  sale: ReportSale;
  action: SalePlanAction;
  lead: { id: string; leadNumber: number; businessName: string; assignedRepId: string | null } | null;
  repId: string | null;
  repName: string | null;
  existing: { id: string; oppNumber: number } | null;
  changes: string[];
  problem: string | null;
  /** a sale entered by hand on the same lead — could be this same sale */
  handEntered: { id: string; oppNumber: number; product: string }[];
}

type Db = Prisma.TransactionClient | typeof prisma;

/** The report's fields as they're stored on a sale. */
function saleData(s: ReportSale, tz: string) {
  const at = (key: string | null) => (key ? zonedToUtc(key, "12:00", tz) : null);
  return {
    signed44: s.signed44,
    runDate: s.runDate,
    goStatus: s.goStatus,
    closedAt: at(s.saleDate),
    openedAt: at(s.apptDate) ?? at(s.saleDate) ?? undefined,
    sourceDetails: s.details,
  };
}

/** Compare JSON details regardless of key order (Postgres reorders JSON keys). */
const stable = (v: unknown) => JSON.stringify(Object.entries((v ?? {}) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
function saleDiff(opp: Record<string, unknown>, next: ReturnType<typeof saleData> & { repId: string }) {
  return diff({ ...opp, sourceDetails: stable(opp.sourceDetails) }, { ...next, sourceDetails: stable(next.sourceDetails) } as Record<string, unknown>);
}

const LABEL: Record<string, string> = { signed44: "Signed 44", runDate: "run date", goStatus: "GO status", closedAt: "sale date", openedAt: "appointment date", sourceDetails: "report details", repId: "rep" };

async function planSales(db: Db, records: { id: string; status: ImportRecordStatus; extracted: Prisma.JsonValue }[], tz: string, fallbackRepId?: string | null): Promise<SalePlan[]> {
  const sales = records.map((r) => r.extracted as unknown as ReportSale);
  const [leads, existing, users] = await Promise.all([
    db.lead.findMany({ where: { externalId: { in: [...new Set(sales.map((s) => s.pn))] } }, select: { id: true, leadNumber: true, businessName: true, externalId: true, assignedRepId: true } }),
    db.opportunity.findMany({ where: { externalRef: { in: sales.map((s) => s.ref) } } }),
    db.user.findMany({ where: { role: "REP" }, select: { id: true, name: true, active: true } }),
  ]);
  const leadByPn = new Map(leads.map((l) => [l.externalId!, l]));
  const oppByRef = new Map(existing.map((o) => [o.externalRef!, o]));
  const hand = await db.opportunity.findMany({ where: { leadId: { in: leads.map((l) => l.id) }, externalRef: null, archivedAt: null }, select: { id: true, oppNumber: true, product: true, leadId: true } });
  const userByName = new Map(users.map((u) => [u.name.trim().toLowerCase(), u]));
  const userName = new Map(users.map((u) => [u.id, u.name]));

  return records.map((r, i) => {
    const sale = sales[i];
    const lead = leadByPn.get(sale.pn) ?? null;
    const opp = oppByRef.get(sale.ref) ?? null;
    // the rep named in the report if they have an account here, otherwise the lead's rep, otherwise the rep the coordinator chose
    const named = userByName.get(reportPersonName(sale.salesRep).toLowerCase());
    const fallback = fallbackRepId && userName.has(fallbackRepId) ? fallbackRepId : null;
    const repId = named?.id ?? lead?.assignedRepId ?? fallback;
    const base = { recordId: r.id, status: r.status, sale, lead, repId, repName: repId ? (userName.get(repId) ?? null) : null, existing: opp ? { id: opp.id, oppNumber: opp.oppNumber } : null, changes: [] as string[], problem: null as string | null, handEntered: lead ? hand.filter((h) => h.leadId === lead.id).map(({ id, oppNumber, product }) => ({ id, oppNumber, product })) : [] };
    if (r.status !== "PENDING") return { ...base, action: "done" as const };
    if (!lead) return { ...base, action: "blocked" as const, problem: `No lead with prospect # ${sale.pn} — import the lead first.` };
    if (opp && opp.leadId !== lead.id) return { ...base, action: "blocked" as const, problem: `Job ${sale.ref} is already recorded on a different lead (O-${opp.oppNumber}).` };
    if (!sale.saleDate) return { ...base, action: "blocked" as const, problem: "The report has no sale date for this job." };
    if (!repId) return { ...base, action: "blocked" as const, problem: "No rep: the lead isn't assigned and the report's rep has no account here. Choose who to record it under above." };
    if (!opp) return { ...base, action: "create" as const };
    const changed = saleDiff(opp as unknown as Record<string, unknown>, { ...saleData(sale, tz), repId });
    const changes = Object.keys(changed).map((k) => LABEL[k] ?? k);
    return { ...base, changes, action: changes.length ? ("update" as const) : ("unchanged" as const) };
  });
}

export async function getSalesImport(actor: Actor, batchId: string, rep?: string | null, fallbackRepId?: string | null) {
  can(actor);
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId }, include: { createdBy: { select: { name: true } } } });
  if (!batch || batch.kind !== "SALES_REPORT") throw notFound("Sales import");
  const tz = (await getSettings()).timezone;
  const records = await prisma.importRecord.findMany({ where: { batchId }, orderBy: { rowNumber: "asc" } });
  const reps = new Map<string, number>();
  for (const r of records) {
    const name = (r.extracted as unknown as ReportSale).salesRep || "(no rep)";
    reps.set(name, (reps.get(name) ?? 0) + 1);
  }
  const shown = rep ? records.filter((r) => ((r.extracted as unknown as ReportSale).salesRep || "(no rep)") === rep) : records;
  return {
    batch,
    meta: salesReportMeta(batch),
    reps: [...reps.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    plans: await planSales(prisma, shown, tz, fallbackRepId),
  };
}

/** Record the chosen sales. Each is re-checked inside the transaction; nothing is created twice. */
export async function applySalesImport(actor: Actor, batchId: string, recordIds: string[], confirmed: boolean, fallbackRepId?: string | null) {
  can(actor);
  if (!recordIds.length) throw invalid("Tick at least one sale to record.");
  if (!confirmed) throw invalid("Confirm that you want to record these sales.");
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.kind !== "SALES_REPORT") throw notFound("Sales import");
  const meta = salesReportMeta(batch);
  const tz = (await getSettings()).timezone;
  const result = await prisma.$transaction(
    async (tx) => {
      const records = await tx.importRecord.findMany({ where: { batchId, id: { in: recordIds }, status: "PENDING" }, orderBy: { rowNumber: "asc" } });
      const plans = await planSales(tx, records, tz, fallbackRepId);
      let created = 0, updated = 0, unchanged = 0, blocked = 0;
      for (const p of plans) {
        if (p.action === "blocked" || !p.lead || !p.repId) {
          blocked++;
          continue;
        }
        const data = saleData(p.sale, tz);
        let oppId: string;
        if (p.action === "create") {
          const opp = await tx.opportunity.create({
            data: { ...data, sourceDetails: data.sourceDetails as Prisma.InputJsonValue, leadId: p.lead.id, repId: p.repId, product: `Job ${p.sale.ref}`, status: "WON", externalRef: p.sale.ref, finalAmount: null, paymentStatus: "NOT_APPLICABLE" },
          });
          oppId = opp.id;
          created++;
          await audit(tx, actor, "opportunity.created", { type: "Opportunity", id: opp.id, leadId: p.lead.id }, `Sale O-${opp.oppNumber} recorded from sales report${meta?.fileName ? ` “${meta.fileName}”` : ""}: job ${p.sale.ref}${p.sale.goStatus ? `, GO status ${p.sale.goStatus}` : ""} (no dollar amount in the report)`);
          // the lead follows the sale (never overrides Do Not Contact)
          const st = (await tx.lead.findUniqueOrThrow({ where: { id: p.lead.id }, select: { status: true } })).status;
          if (st !== "WON" && st !== "DO_NOT_CONTACT") await changeLeadStatusInTx(tx, actor, p.lead.id, "WON");
        } else {
          const before = await tx.opportunity.findUniqueOrThrow({ where: { id: p.existing!.id } });
          oppId = before.id;
          if (p.action === "update") {
            await tx.opportunity.update({ where: { id: before.id }, data: { ...data, sourceDetails: data.sourceDetails as Prisma.InputJsonValue, repId: p.repId, version: { increment: 1 } } });
            const changed = saleDiff(before as unknown as Record<string, unknown>, { ...data, repId: p.repId });
            await audit(tx, actor, "opportunity.updated", { type: "Opportunity", id: before.id, leadId: p.lead.id }, `Sale O-${before.oppNumber} updated from sales report${meta?.fileName ? ` “${meta.fileName}”` : ""} (${p.changes.join(", ")})`, changed as Prisma.InputJsonValue);
            updated++;
          } else unchanged++;
        }
        await tx.importRecord.update({ where: { id: p.recordId }, data: { status: "IMPORTED", leadId: p.lead.id, error: null, edited: { opportunityId: oppId } } });
      }
      if (!(await tx.importRecord.count({ where: { batchId, status: "PENDING" } }))) await tx.importBatch.update({ where: { id: batchId }, data: { completedAt: new Date() } });
      return { created, updated, unchanged, blocked };
    },
    { timeout: 60_000 },
  );
  return result;
}

export async function skipSalesRecords(actor: Actor, batchId: string, recordIds: string[]) {
  can(actor);
  await prisma.importRecord.updateMany({ where: { batchId, id: { in: recordIds }, status: "PENDING" }, data: { status: "SKIPPED" } });
  if (!(await prisma.importRecord.count({ where: { batchId, status: "PENDING" } }))) await prisma.importBatch.update({ where: { id: batchId }, data: { completedAt: new Date() } });
}
