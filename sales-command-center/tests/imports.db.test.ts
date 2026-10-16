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

  it("appointment-log exports: one lead per prospect #, dated appointments, every other column kept, re-import safe", async () => {
    const H = "APPTDATE,PN,APPT,APPTTIME,BC,Region,COMPANY,ADDRESS,CITY,ST,ZIP,PHONE,Name,EmployeeCount,SitComments,Frame18,Frame113,Option120,Option122,Text124,Combo23,Text129,Text131,Text133,Text137,Combo141";
    const rows = [
      "06-May-26,900000001,1,06-May-26,104040,SW,Zephyr Test Roofing,1 Sample Rd,Lexington,KY,405040001,(859) 555-0141,Ann Example,12,,,,False,False,SMS,\"Rep, Riley\",CONFIRMED,06-May-26,DR,2,BC Dept",
      "01-Jul-26,900000001,2,02-Jan-00,104040,SW,Zephyr Test Roofing,1 Sample Rd,Lexington,KY,405040001,(859) 555-0141,Ann Example,12,,1.0,,False,False,SMS,\"Rep, Riley\",,01-Jul-26,DR,2,BC Dept",
      "30-Jun-26,900000002,1,02-Jan-00,104040,SW,Quillon Test Heating,2 Sample Rd,Richmond,KY,40475,(859) 555-0142,Bo Example,,,,,False,False,SMS,\"Mozzano, Louis\",CONFIRMED,30-Jun-26,HC,2,BC Dept",
    ];
    const file = () => new File([[H, ...rows].join("\n")], "Rep_Leads.csv", { type: "text/csv" });
    const batch = await imp.createCsvBatch(U.coordinator, file());
    const meta = imp.csvMeta(batch)!;
    expect(meta.preset).toBe("Appointment log export");
    expect(meta.mapping).toMatchObject({ APPTDATE: "appointmentDate", PN: "externalId", COMPANY: "businessName", Name: "contactName", ST: "state", EmployeeCount: "employeeCount", Combo23: "repName", Text129: "appointmentStatus", BC: "", Region: "" });
    const review = await imp.getBatchForReview(U.coordinator, batch.id, { view: "all" });
    expect(review.records[0].values.zip).toBe("40504-0001"); // same digits, shown as ZIP+4
    expect(review.records[0].values.appointmentTime ?? null).toBeNull(); // "06-May-26" in a time column isn't a time
    expect(review.records[1].follower).toBe(true);
    expect(review.records[0].rep?.id).toBe(U.rep.id); // "Rep, Riley" → Riley Rep
    expect(review.records[2].rep).toBeNull();
    expect(review.records[2].flags.some((f) => f.message.includes("isn't a sales rep login"))).toBe(true);
    expect(review.counts.clean).toBe(3);

    const res = await imp.importCleanRows(U.coordinator, batch.id, { assignedRepId: U.rep2.id });
    expect(res).toMatchObject({ imported: 2, merged: 1, appointments: 3, failed: 0, left: 0 });
    const zephyr = await prisma.lead.findUniqueOrThrow({ where: { externalId: "900000001" }, include: { appointments: { orderBy: { startAt: "asc" } } } });
    expect(zephyr).toMatchObject({ businessName: "Zephyr Test Roofing", contactName: "Ann Example", employeeCount: 12, zip: "40504-0001", assignedRepId: U.rep.id });
    // past dates = appointments that were held: completed, and each recorded as a visit (no time invented)
    expect(zephyr.appointments.map((a) => [a.status, a.timeSet, a.repId])).toEqual([["COMPLETED", false, U.rep.id], ["COMPLETED", false, U.rep.id]]);
    const zv = await prisma.visit.findMany({ where: { leadId: zephyr.id }, orderBy: { visitAt: "asc" } });
    expect(zv.map((v) => [v.type, v.outcome, v.timeSet, v.feedback])).toEqual([["SCHEDULED_APPOINTMENT", "OTHER", false, null], ["SCHEDULED_APPOINTMENT", "OTHER", false, null]]);
    expect(zephyr.visitCount).toBe(2);
    expect(zephyr.lastVisitAt?.getTime()).toBe(zephyr.appointments[1].startAt.getTime());
    expect(zephyr.status).toBe("VISITED");
    expect(zephyr.sourceDetails).toMatchObject({ APPT: "1", BC: "104040", Region: "SW", Text133: "DR", Combo141: "BC Dept", Option120: "False" });
    expect(Object.keys(zephyr.sourceDetails as object)).not.toContain("COMPANY");
    const quillon = await prisma.lead.findUniqueOrThrow({ where: { externalId: "900000002" }, include: { appointments: true } });
    expect(quillon.assignedRepId).toBe(U.rep2.id); // unknown rep in file → the default chosen for the import
    expect(quillon.appointments[0].status).toBe("COMPLETED");
    // one summary notification per rep, not one per lead
    expect(await prisma.notification.count({ where: { dedupeKey: { startsWith: `import-assign:${batch.id}:` } } })).toBe(2);

    // the same file again (e.g. an updated export): nothing is duplicated
    const leadsBefore = await prisma.lead.count();
    const apptsBefore = await prisma.appointment.count();
    const again = await imp.createCsvBatch(U.coordinator, file());
    const r2 = await imp.importCleanRows(U.coordinator, again.id);
    expect(r2).toMatchObject({ imported: 0, merged: 3, appointments: 0 });
    expect(await prisma.lead.count()).toBe(leadsBefore);
    expect(await prisma.appointment.count()).toBe(apptsBefore);
    expect(await prisma.visit.count({ where: { leadId: zephyr.id } })).toBe(2);
  });

  it("an imported appointment dated today or later stays upcoming, with the file's status, and isn't a visit", async () => {
    const H = "APPTDATE,PN,COMPANY,ADDRESS,CITY,ST,ZIP,PHONE,Name,Combo23,Text129";
    const future = new Date(Date.now() + 10 * 86_400_000);
    const d = `${String(future.getUTCDate()).padStart(2, "0")}-${future.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}-${String(future.getUTCFullYear()).slice(2)}`;
    const batch = await imp.createCsvBatch(U.coordinator, new File([`${H}\n${d},900000003,Upcoming Test Signs,3 Sample Rd,Berea,KY,40403,(859) 555-0143,Cy Example,"Rep, Riley",CONFIRMED`], "x.csv"));
    await imp.importCleanRows(U.coordinator, batch.id);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { externalId: "900000003" }, include: { appointments: true, visits: true } });
    expect(lead.appointments[0]).toMatchObject({ status: "CONFIRMED", timeSet: false });
    expect(lead.visits).toHaveLength(0);
    expect(lead.status).toBe("APPOINTMENT_SCHEDULED");
  });

  it("places each imported lead in its city's area: reuses existing areas, creates missing ones under the state's territory", async () => {
    // an area the coordinator already set up, in their own territory
    const east = await prisma.territory.create({ data: { name: "East KY Route" } });
    const somerset = await prisma.area.create({ data: { territoryId: east.id, name: "Somerset" } });
    const csv = "Company,Phone,Address,City,State,Zip\nCity Test Plumbing,(606) 555-0150,1 Main St,SOMERSET,KY,42501\nCity Test Florist,(859) 555-0151,2 Main St,LEXINGTON,KY,40507\nCity Test Bakery,(859) 555-0152,3 Main St,Lexington,KY,40508\nCity Test Garage,(865) 555-0153,4 Main St,Knoxville,TN,37902\n";
    const batch = await imp.createCsvBatch(U.coordinator, new File([csv], "cities.csv"));
    const res = await imp.importCleanRows(U.coordinator, batch.id, { areaId: imp.AREA_BY_CITY });
    expect(res.imported).toBe(4);
    const leads = await prisma.lead.findMany({ where: { businessName: { startsWith: "City Test" } }, include: { area: true, territory: true } });
    const by = Object.fromEntries(leads.map((l) => [l.businessName, l]));
    expect(by["City Test Plumbing"].areaId).toBe(somerset.id); // existing area reused, even with different capitalization
    expect(by["City Test Plumbing"].territoryId).toBe(east.id);
    expect(by["City Test Florist"].area?.name).toBe("Lexington");
    expect(by["City Test Florist"].territory?.name).toBe("Kentucky");
    expect(by["City Test Bakery"].areaId).toBe(by["City Test Florist"].areaId); // one Lexington area, not two
    expect(by["City Test Garage"].territory?.name).toBe("Tennessee");
    expect(await prisma.area.count({ where: { name: "Lexington" } })).toBe(1);
  });
});
