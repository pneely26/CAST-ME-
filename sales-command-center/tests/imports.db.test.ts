import { describe, it, expect, beforeAll, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { TEST_URL, setupTestDb, makeUsers } from "./helpers";
import type { ExtractionProvider } from "@/server/extraction/types";

process.env.UPLOAD_DIR = path.join(os.tmpdir(), `scc-test-uploads-${process.pid}`);

const png = (seed: number) => new File([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, seed)])], `shot-${seed}.png`, { type: "image/png" });

const fake: ExtractionProvider = {
  id: "fake",
  label: "Fake reader",
  async extract() {
    return {
      rawText: "Joe's Pizza & Grill\n(312) 555-0101\nClosed Mondays — ask for Maria\n\nBlue Door Bakery\n1200 N Clark St",
      leads: [
        { values: { businessName: "Joe's Pizza & Grill", phone: "(312) 555-0101", notes: "Closed Mondays — ask for Maria", address: null, email: null }, confidence: { businessName: "high", phone: "high", notes: "high" }, sourceText: "Joe's Pizza & Grill\n(312) 555-0101" },
        { values: { businessName: "Blue Door Bakery", address: "1200 N Clark St", phone: null }, confidence: { businessName: "high", address: "low" }, sourceText: "Blue Door Bakery\n1200 N Clark St" },
      ],
    };
  },
};

describe.skipIf(!TEST_URL)("lead imports (database)", () => {
  let prisma: PrismaClient;
  let U: Awaited<ReturnType<typeof makeUsers>>;
  let imp: typeof import("@/server/services/imports");
  let leads: typeof import("@/server/services/leads");
  let ext: typeof import("@/server/extraction");

  beforeAll(async () => {
    prisma = await setupTestDb();
    U = await makeUsers(prisma);
    imp = await import("@/server/services/imports");
    leads = await import("@/server/services/leads");
    ext = await import("@/server/extraction");
  }, 120_000);
  afterEach(() => ext.setExtractionProviderForTests(undefined));

  it("without a provider, screenshots are stored but nothing is extracted", async () => {
    ext.setExtractionProviderForTests(null);
    const batch = await imp.createScreenshotBatch(U.coordinator, [png(1)]);
    const img = await prisma.importImage.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(img.status).toBe("NOT_CONFIGURED");
    expect((await imp.extractImage(U.coordinator, img.id)).status).toBe("NOT_CONFIGURED");
    expect(await prisma.importRecord.count({ where: { batchId: batch.id } })).toBe(0);
    expect(img.rawText).toBeNull();
  });

  it("reps cannot import", async () => {
    await expect(imp.createScreenshotBatch(U.rep, [png(2)])).rejects.toThrow(/coordinator/);
  });

  it("extraction keeps raw text, leaves missing values blank, and flags low confidence", async () => {
    ext.setExtractionProviderForTests(fake);
    const batch = await imp.createScreenshotBatch(U.coordinator, [png(3), png(3)]);
    const imgs = await prisma.importImage.findMany({ where: { batchId: batch.id }, orderBy: { createdAt: "asc" } });
    expect(imgs.map((i) => i.status).sort()).toEqual(["DUPLICATE", "UPLOADED"]);
    const first = imgs.find((i) => i.status === "UPLOADED")!;
    const r = await imp.extractImage(U.coordinator, first.id);
    expect(r).toMatchObject({ status: "EXTRACTED", count: 2 });
    const stored = await prisma.importImage.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.rawText).toContain("Closed Mondays — ask for Maria");
    const review = await imp.getBatchForReview(U.coordinator, batch.id, { view: "all" });
    const bakery = review.records.find((x) => x.values.businessName === "Blue Door Bakery")!;
    expect(bakery.values.phone ?? null).toBeNull(); // not guessed
    expect(bakery.flags.some((f) => f.message.includes("No phone or email"))).toBe(true);
    expect(bakery.flags.some((f) => f.field === "address" && f.message.startsWith("Low"))).toBe(true);
    expect(bakery.clean).toBe(false);
  });

  it("duplicates are never created silently; merge fills only empty fields and appends notes verbatim", async () => {
    ext.setExtractionProviderForTests(fake);
    const existing = await leads.createLead(U.coordinator, { businessName: "Joe's Pizza & Grill", phone: "312-555-0101", contactName: "Joe", notes: "Original note." });
    const batch = await imp.createScreenshotBatch(U.coordinator, [png(4)]);
    const img = await prisma.importImage.findFirstOrThrow({ where: { batchId: batch.id } });
    await imp.extractImage(U.coordinator, img.id);
    const review = await imp.getBatchForReview(U.coordinator, batch.id);
    const joe = review.records.find((x) => x.values.businessName === "Joe's Pizza & Grill")!;
    expect(joe.duplicates.map((d) => d.id)).toContain(existing.id);

    const before = await prisma.lead.count();
    const bulk = await imp.importCleanRows(U.coordinator, batch.id);
    expect(bulk.imported).toBe(0); // joe matched an existing lead; bakery has a low-confidence value
    expect(await prisma.lead.count()).toBe(before);
    await expect(imp.importAsNew(U.coordinator, joe.id)).rejects.toThrow(/existing lead/);

    await imp.saveRecordEdits(U.coordinator, joe.id, { ...joe.values, contactName: "Maria", email: "maria@joes.example" });
    const merged = await imp.mergeInto(U.coordinator, joe.id, existing.id);
    expect(merged.filled).toEqual(expect.arrayContaining(["email", "notes"]));
    expect(merged.kept).toContain("contactName");
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.contactName).toBe("Joe"); // not overwritten
    expect(after.email).toBe("maria@joes.example");
    expect(after.notes).toMatch(/^Original note\.\n\n— Imported \d{4}-\d{2}-\d{2} —\nClosed Mondays — ask for Maria$/);
    expect((await prisma.importRecord.findUniqueOrThrow({ where: { id: joe.id } })).status).toBe("MERGED");
    await expect(imp.mergeInto(U.coordinator, joe.id, existing.id)).rejects.toThrow(/already handled/);
  });

  it("CSV import maps columns, supports partial imports, and re-importing does not duplicate", async () => {
    const csv = "Company,Phone Number,Street Address,Zip,Owner,Comments,Ignored\nNorth Star Cafe,773-555-0199,10 W Elm St,60610,Ana,\"Wants a call after 3pm, not before\",x\nBad Zip Deli,773-555-0142,5 Oak St,6061,,,\n,773-555-0100,,,,,\n";
    const file = new File([csv], "leads.csv", { type: "text/csv" });
    const batch = await imp.createCsvBatch(U.coordinator, file);
    const meta = imp.csvMeta(batch)!;
    expect(meta.mapping).toMatchObject({ Company: "businessName", "Phone Number": "phone", "Street Address": "address", Zip: "zip", Owner: "contactName", Comments: "notes", Ignored: "" });
    const review = await imp.getBatchForReview(U.coordinator, batch.id, { view: "all" });
    expect(review.counts.total).toBe(3);
    expect(review.counts.clean).toBe(1);
    const res = await imp.importCleanRows(U.coordinator, batch.id, { assignedRepId: U.rep.id });
    expect(res).toMatchObject({ imported: 1, failed: 0, left: 2 });
    const lead = await prisma.lead.findFirstOrThrow({ where: { businessName: "North Star Cafe" } });
    expect(lead.notes).toBe("Wants a call after 3pm, not before");
    expect(lead.assignedRepId).toBe(U.rep.id);
    expect(lead.source).toBe("CSV import");

    const noName = review.records.find((r) => !r.values.businessName)!;
    await expect(imp.importAsNew(U.coordinator, noName.id)).rejects.toThrow(/Business name/);
    expect(await imp.skipRecords(U.coordinator, [noName.id])).toBe(1);

    const again = await imp.createCsvBatch(U.coordinator, new File([csv], "leads.csv", { type: "text/csv" }));
    const review2 = await imp.getBatchForReview(U.coordinator, again.id, { view: "all" });
    expect(review2.counts.clean).toBe(0); // the matching row is flagged before anything is imported
    expect(review2.records.find((r) => r.values.businessName === "North Star Cafe")!.duplicates.length).toBeGreaterThan(0);
    const r2 = await imp.importCleanRows(U.coordinator, again.id);
    expect(r2.imported).toBe(0);
    expect(await prisma.lead.count({ where: { businessName: "North Star Cafe" } })).toBe(1);
  });

  it("remapping a CSV re-applies to rows still under review", async () => {
    const batch = await imp.createCsvBatch(U.coordinator, new File(["Shop,Tel\nRiver Books,312-555-0177\n"], "x.csv"));
    let review = await imp.getBatchForReview(U.coordinator, batch.id);
    expect(review.records[0].values.businessName ?? null).toBeNull();
    await expect(imp.remapCsv(U.coordinator, batch.id, { Shop: "", Tel: "phone" })).rejects.toThrow(/Business name/);
    await imp.remapCsv(U.coordinator, batch.id, { Shop: "businessName", Tel: "phone" });
    review = await imp.getBatchForReview(U.coordinator, batch.id);
    expect(review.records[0].values).toMatchObject({ businessName: "River Books", phone: "312-555-0177" });
  });
});
