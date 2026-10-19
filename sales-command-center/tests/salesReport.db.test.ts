import { describe, it, expect, beforeAll } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TEST_URL, setupTestDb, makeUsers } from "./helpers";
import { groupReportSales, parseSalesReport, reportDate, reportPersonName, type PdfItem, type PdfMark, type PdfPageContent } from "@/lib/domain/salesReport";

// Column positions as laid out in a real BC History report (points from the left).
const HEADER: [string, number][] = [["BC", 108], ["PN/Job #", 130], ["SRC", 180.1], ["COMPANY", 204.5], ["RVOL", 253.8], ["AVOL", 279.7], ["44", 305.8], ["Confirmer", 322], ["Sales Rep", 374.5], ["Analyst", 429.6], ["Appt Date", 468.9], ["Sale Date", 516.3], ["Run Date", 560.4], ["Survey Result", 615.3], ["MS Status", 695.3], ["Notes", 748.9]];
const W = 5; // rough width per character

type Row = { n: number; pn: string; src: string; company: string; rvol: string; avol?: string; confirmer: string; rep: string; repX?: number; analyst?: string; appt: string; sale: string; run: string; survey?: string[]; ms?: string[]; checked: boolean };

function page(rows: Row[]): PdfPageContent {
  const items: PdfItem[] = [{ str: "BC History", x: 81.8, y: 43.1 }, { str: "All Sales: 1/1/2026 to 10/24/2026", x: 321, y: 77.6 }];
  for (const [str, x] of HEADER) items.push({ str, x, y: 137.4, w: str.length * W });
  const marks: PdfMark[] = [];
  rows.forEach((r, i) => {
    const y = 159.8 + i * 11.52;
    const put = (str: string, x: number) => items.push({ str, x, y, w: str.length * W });
    put(String(r.n), 19);
    put("104040", 36.5);
    put("Floyd-Burnett,", 67.6);
    items.push({ str: "Paige", x: 67.6, y: y + 9.3, w: 25 }); // overflow of the BC cell: drawn a line lower and clipped (invisible)
    put(r.pn, 125.4);
    put(r.src, 182.1);
    put(r.company, 199.4);
    items.push({ str: "Hidden Overflow Co", x: 199.4, y: y + 9.3, w: 80 });
    put(r.rvol, 257.3);
    if (r.avol) put(r.avol, 283.3);
    put(r.confirmer, 323.4);
    put(r.rep, r.repX ?? 370.8);
    if (r.analyst) put(r.analyst, 426.4);
    put(r.appt, 472);
    put(r.sale, 516.7);
    put(r.run, 562.6);
    (r.survey ?? []).forEach((s, k) => put(s, 611.1 + k * 25));
    (r.ms ?? []).forEach((s, k) => put(s, 707.8 + k * 22));
    put("DR", 752.3);
    marks.push({ x: 303.24, y: y - 8.6, w: 14.4, h: 11.52, checked: r.checked });
  });
  return { items, marks };
}

const ROWS: Row[] = [
  { n: 1, pn: "218262125 - 1", src: "TA", company: "Riverside", rvol: "3.00", avol: "3.00", confirmer: "House,", rep: "Mozzano, Louis", analyst: "Daetwyler,", appt: "7/6/2026", sale: "7/6/2026", run: "7/8/2026", survey: ["GO/NFC", "GR", "150", "GR"], ms: ["CLO", "206"], checked: true },
  { n: 2, pn: "218263345 - 2", src: "TA", company: "Hemenway", rvol: "2.00", avol: "2.00", confirmer: "Owen, John", rep: "Mozzano, Louis", analyst: "Hall, Stephen", appt: "7/30/2026", sale: "7/30/2026", run: "8/3/2026", survey: ["GO/NFC", "CBS", "150", "CBS"], ms: ["CLO", "0"], checked: true },
  { n: 3, pn: "218263345 - 2", src: "TA", company: "Hemenway", rvol: "2.00", avol: "2.00", confirmer: "Owen, John", rep: "Mozzano, Louis", analyst: "Hall, Stephen", appt: "7/30/2026", sale: "7/30/2026", run: "8/3/2026", survey: ["GO/NFC", "TAVPL"], checked: true },
  { n: 4, pn: "218267188 - 1", src: "TB", company: "EcoTight", rvol: "1.10", avol: "1.10", confirmer: "Owen, John", rep: "Mozzano, Louis", appt: "9/14/2026", sale: "9/14/2026", run: "9/15/2026", survey: ["XCL"], checked: false },
  // a long, centered rep name starts left of the "Sales Rep" header
  { n: 5, pn: "218256482 - 1", src: "TA", company: "Fence 1", rvol: "7.00", avol: "7.00", confirmer: "Black, Kyle", rep: "Battell, Benjamin", repX: 363, appt: "4/20/2026", sale: "4/20/2026", run: "4/21/2026", survey: ["GO"], checked: true },
  { n: 6, pn: "99999999 - 1", src: "TB", company: "Not Imported", rvol: "1.00", confirmer: "Owen, John", rep: "Mozzano, Louis", appt: "10/1/2026", sale: "10/2/2026", run: "10/9/2026", checked: true },
];

describe("sales report parsing", () => {
  it("reads dates and names as printed", () => {
    expect(reportDate("7/15/2026")).toBe("2026-07-15");
    expect(reportDate("2/30/2026")).toBeNull();
    expect(reportDate("")).toBeNull();
    expect(reportPersonName("Mozzano, Louis")).toBe("Louis Mozzano");
    expect(reportPersonName("Schrobback,")).toBe("Schrobback");
  });

  it("reads each row's visible cells, ignores clipped overflow text, and reads the 44 check box", () => {
    const r = parseSalesReport([page(ROWS)]);
    expect(r.problems).toEqual([]);
    expect(r.title).toBe("BC History");
    expect(r.rows).toHaveLength(6);
    const [a, , , eco, fence] = r.rows;
    expect(a).toMatchObject({ rowNumber: 1, pn: "218262125", job: "1", src: "TA", company: "Riverside", rvol: "3.00", avol: "3.00", signed44: true, confirmer: "House", salesRep: "Mozzano, Louis", analyst: "Daetwyler", apptDate: "2026-07-06", saleDate: "2026-07-06", runDate: "2026-07-08", surveyResult: "GO/NFC GR 150 GR", msStatus: "CLO 206", notes: "DR" });
    expect(eco.signed44).toBe(false);
    expect(fence.salesRep).toBe("Battell, Benjamin");
    expect(fence.confirmer).toBe("Black, Kyle");
    expect(r.rows.map((x) => x.company).join(" ")).not.toMatch(/Hidden|Paige/);
  });

  it("groups report lines into one sale per PN/Job #, keeping every survey line", () => {
    const sales = groupReportSales(parseSalesReport([page(ROWS)]).rows);
    expect(sales).toHaveLength(5);
    const hem = sales.find((s) => s.ref === "218263345-2")!;
    expect(hem).toMatchObject({ pn: "218263345", job: "2", signed44: true, saleDate: "2026-07-30", runDate: "2026-08-03", goStatus: "GO/NFC CBS 150 CBS | GO/NFC TAVPL", rowNumbers: [2, 3] });
    expect(hem.details).toMatchObject({ RVOL: "2.00", AVOL: "2.00", "MS Status": "CLO 0", Analyst: "Hall, Stephen" });
  });

  it("says so when the PDF isn't a sales report", () => {
    const r = parseSalesReport([{ items: [{ str: "Some other document", x: 10, y: 10 }], marks: [] }]);
    expect(r.rows).toHaveLength(0);
    expect(r.problems[0]).toMatch(/doesn't look like a BC History/);
  });
});

describe.skipIf(!TEST_URL)("sales report import (database)", () => {
  let prisma: PrismaClient;
  let U: Awaited<ReturnType<typeof makeUsers>>;
  let si: typeof import("@/server/services/salesImports");
  let reports: typeof import("@/server/services/reports");
  const all = { preset: "all" as const, startKey: "1970-01-01", endKey: "2999-12-31", start: new Date(0), end: new Date(8.64e15), label: "All time" };

  async function batchFrom(rows: Row[]) {
    const sales = groupReportSales(parseSalesReport([page(rows)]).rows);
    const b = await prisma.importBatch.create({ data: { kind: "SALES_REPORT", createdById: U.coordinator.id, provider: "PDF", notes: JSON.stringify({ fileName: "BCHistory.pdf", title: "BC History", generatedOn: null, period: null, rowCount: rows.length, problems: [] }) } });
    await prisma.importRecord.createMany({ data: sales.map((s) => ({ batchId: b.id, rowNumber: s.rowNumbers[0], extracted: s as unknown as Prisma.InputJsonValue })) });
    return b.id;
  }
  const lead = (name: string, pn: string) => prisma.lead.create({ data: { businessName: name, normalizedName: name.toLowerCase(), externalId: pn, assignedRepId: U.rep.id } });

  beforeAll(async () => {
    prisma = await setupTestDb();
    U = await makeUsers(prisma);
    si = await import("@/server/services/salesImports");
    reports = await import("@/server/services/reports");
    // the report's rep has an account here
    await prisma.user.update({ where: { id: U.rep2.id }, data: { name: "Louis Mozzano" } });
    await lead("Riverside Management", "218262125");
    await lead("Hemenway Concrete", "218263345");
    await lead("EcoTight", "218267188");
    await lead("Fence 1 Landscaping", "218256482");
  }, 120_000);

  it("previews per rep: new sales, missing leads, and sales already entered by hand", async () => {
    const hem = await prisma.lead.findFirstOrThrow({ where: { externalId: "218263345" } });
    await prisma.opportunity.create({ data: { leadId: hem.id, repId: U.rep.id, product: "Hand-entered package", status: "PROPOSAL" } });
    const id = await batchFrom(ROWS);
    const d = await si.getSalesImport(U.coordinator, id, "Mozzano, Louis");
    expect(d.reps.map((r) => r.name)).toEqual(["Mozzano, Louis", "Battell, Benjamin"]);
    expect(d.plans).toHaveLength(4);
    const by = Object.fromEntries(d.plans.map((p) => [p.sale.ref, p]));
    expect(by["218262125-1"]).toMatchObject({ action: "create", repId: U.rep2.id, repName: "Louis Mozzano" });
    expect(by["99999999-1"]).toMatchObject({ action: "blocked" });
    expect(by["99999999-1"].problem).toMatch(/No lead with prospect # 99999999/);
    expect(by["218263345-2"].handEntered).toHaveLength(1);
    await expect(si.getSalesImport(U.rep, id)).rejects.toThrow(/coordinator/);
  });

  it("records won sales with the report's fields, no dollar amount, and no double counting on re-import", async () => {
    const before = (await reports.salesReport(U.coordinator, {}, all)).summary;
    const id = await batchFrom(ROWS);
    const plans = (await si.getSalesImport(U.coordinator, id, "Mozzano, Louis")).plans;
    await expect(si.applySalesImport(U.coordinator, id, plans.map((p) => p.recordId), false)).rejects.toThrow(/Confirm/);
    await expect(si.applySalesImport(U.rep, id, plans.map((p) => p.recordId), true)).rejects.toThrow(/coordinator/);
    const r = await si.applySalesImport(U.coordinator, id, plans.map((p) => p.recordId), true);
    expect(r).toEqual({ created: 3, updated: 0, unchanged: 0, blocked: 1 });

    const hem = await prisma.opportunity.findUniqueOrThrow({ where: { externalRef: "218263345-2" }, include: { lead: true } });
    expect(hem).toMatchObject({ status: "WON", finalAmount: null, signed44: true, runDate: "2026-08-03", goStatus: "GO/NFC CBS 150 CBS | GO/NFC TAVPL", repId: U.rep2.id, product: "Job 218263345-2" });
    expect(hem.closedAt).not.toBeNull();
    expect(hem.lead.status).toBe("WON");
    expect((hem.sourceDetails as Record<string, string>).AVOL).toBe("2.00");
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { externalRef: "218267188-1" } })).signed44).toBe(false);

    const after = (await reports.salesReport(U.coordinator, {}, all)).summary;
    expect(after.wonCount).toBe(before.wonCount + 3);
    expect(after.revenue).toBe(before.revenue); // the report has no dollar amounts

    // uploading the same report again changes nothing
    const again = await batchFrom(ROWS);
    const p2 = (await si.getSalesImport(U.coordinator, again, "Mozzano, Louis")).plans;
    expect(p2.filter((p) => p.action === "unchanged")).toHaveLength(3);
    await si.applySalesImport(U.coordinator, again, p2.map((p) => p.recordId), true);
    expect(await prisma.opportunity.count({ where: { externalRef: { not: null } } })).toBe(3);

    // a later report with a new GO result updates the same sale
    const later = await batchFrom(ROWS.map((x) => (x.n === 4 ? { ...x, survey: ["GO"], run: "9/22/2026" } : x)));
    const p3 = (await si.getSalesImport(U.coordinator, later, "Mozzano, Louis")).plans;
    const eco = p3.find((p) => p.sale.ref === "218267188-1")!;
    expect(eco.action).toBe("update");
    expect(eco.changes).toEqual(expect.arrayContaining(["GO status", "run date"]));
    expect(await si.applySalesImport(U.coordinator, later, [eco.recordId], true)).toMatchObject({ updated: 1 });
    const ecoOpp = await prisma.opportunity.findUniqueOrThrow({ where: { externalRef: "218267188-1" } });
    expect(ecoOpp).toMatchObject({ goStatus: "GO", runDate: "2026-09-22" });
    expect(await prisma.auditLog.count({ where: { entityId: ecoOpp.id, action: "opportunity.updated" } })).toBe(1);
  });

  it("a sale with no rep (unassigned lead, report rep without an account) waits until the coordinator picks one", async () => {
    await prisma.lead.update({ where: { externalId: "218256482" }, data: { assignedRepId: null } });
    const id = await batchFrom(ROWS);
    const p = (await si.getSalesImport(U.coordinator, id, "Battell, Benjamin")).plans[0];
    expect(p).toMatchObject({ action: "blocked", repId: null });
    expect((await si.getSalesImport(U.coordinator, id, "Battell, Benjamin", U.rep.id)).plans[0]).toMatchObject({ action: "create", repId: U.rep.id });
    expect(await si.applySalesImport(U.coordinator, id, [p.recordId], true, U.rep.id)).toMatchObject({ created: 1 });
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { externalRef: "218256482-1" } })).repId).toBe(U.rep.id);
  });

  it("an imported sale can be edited without inventing an amount; hand-entered won sales still need one", async () => {
    const opps = await import("@/server/services/opportunities");
    const o = await prisma.opportunity.findUniqueOrThrow({ where: { externalRef: "218262125-1" } });
    const saved = await opps.saveOpportunity(U.coordinator, o.id, { leadId: o.leadId, repId: o.repId, product: o.product, status: "WON", goStatus: "GO — installed" }, o.version);
    expect(saved).toMatchObject({ goStatus: "GO — installed", finalAmount: null });
    await expect(opps.saveOpportunity(U.coordinator, null, { leadId: o.leadId, product: "Manual", status: "WON", confirmed: true })).rejects.toThrow(/final sale amount/);
  });
});
