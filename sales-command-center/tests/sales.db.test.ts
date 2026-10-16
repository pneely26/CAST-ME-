import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TEST_URL, setupTestDb, makeUsers } from "./helpers";

describe.skipIf(!TEST_URL)("sales (database)", () => {
  let prisma: PrismaClient;
  let U: Awaited<ReturnType<typeof makeUsers>>;
  let leads: typeof import("@/server/services/leads");
  let opps: typeof import("@/server/services/opportunities");
  let q: typeof import("@/server/services/salesQuery");
  let reports: typeof import("@/server/services/reports");
  const all = { preset: "all" as const, startKey: "1970-01-01", endKey: "2999-12-31", start: new Date(0), end: new Date(8.64e15), label: "All time" };

  beforeAll(async () => {
    prisma = await setupTestDb();
    U = await makeUsers(prisma);
    leads = await import("@/server/services/leads");
    opps = await import("@/server/services/opportunities");
    q = await import("@/server/services/salesQuery");
    reports = await import("@/server/services/reports");
  }, 120_000);

  const newLead = (name: string, repId = U.rep.id) => leads.createLead(U.coordinator, { businessName: name, phone: `773555${Math.floor(1000 + Math.random() * 8999)}`, assignedRepId: repId });

  it("closing as won requires confirmation and a final amount", async () => {
    const lead = await newLead("Confirm Diner");
    await expect(opps.saveOpportunity(U.rep, null, { leadId: lead.id, product: "POS system", status: "WON", finalAmount: 1200 })).rejects.toThrow(/Confirm/);
    await expect(opps.saveOpportunity(U.rep, null, { leadId: lead.id, product: "POS system", status: "WON", confirmed: true })).rejects.toThrow(/final sale amount/);
    expect(await prisma.opportunity.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("a won sale marks the lead Won, notifies the coordinator, and counts once in revenue", async () => {
    const lead = await newLead("Won Pizza");
    const open = await opps.saveOpportunity(U.rep, null, { leadId: lead.id, product: "Signage", estimatedValue: 5000 });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("OPPORTUNITY_IN_PROGRESS");
    const won = await opps.saveOpportunity(U.rep, open.id, { leadId: lead.id, product: "Signage", status: "WON", estimatedValue: 5000, finalAmount: 4200, commissionRatePct: 10, confirmed: true }, open.version);
    expect(won.closedAt).not.toBeNull();
    expect(Number(won.commissionAmount)).toBe(420);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("WON");
    expect(await prisma.notification.count({ where: { userId: U.coordinator.id, type: "NEW_SALE" } })).toBe(1);
    // saving again (no change) must not double count or re-notify
    await opps.saveOpportunity(U.rep, won.id, { leadId: lead.id, product: "Signage", status: "WON", finalAmount: 4200, commissionRatePct: 10 }, won.version);
    expect(await prisma.notification.count({ where: { userId: U.coordinator.id, type: "NEW_SALE" } })).toBe(1);
    const r = await reports.salesReport(U.coordinator, {}, all);
    expect(r.summary.wonCount).toBe(1);
    expect(r.summary.revenue).toBe(4200);
    expect(r.summary.pipelineValue).toBe(0); // the estimate left the pipeline when it closed
  });

  it("open pipeline stays separate from realized revenue", async () => {
    const lead = await newLead("Pipeline Salon");
    await opps.saveOpportunity(U.coordinator, null, { leadId: lead.id, product: "Website", estimatedValue: 3000 });
    const r = await reports.salesReport(U.coordinator, {}, all);
    expect(r.summary.revenue).toBe(4200);
    expect(r.summary.pipelineValue).toBe(3000);
  });

  it("changing a won amount or reopening a won sale needs confirmation", async () => {
    const lead = await newLead("Reopen Deli");
    const won = await opps.saveOpportunity(U.coordinator, null, { leadId: lead.id, product: "Menu boards", status: "WON", finalAmount: 800, confirmed: true });
    await expect(opps.saveOpportunity(U.coordinator, won.id, { leadId: lead.id, product: "Menu boards", status: "WON", finalAmount: 900 }, won.version)).rejects.toThrow(/Confirm/);
    await expect(opps.saveOpportunity(U.coordinator, won.id, { leadId: lead.id, product: "Menu boards", status: "NEGOTIATION" }, won.version)).rejects.toThrow(/reopen/);
    const reopened = await opps.saveOpportunity(U.coordinator, won.id, { leadId: lead.id, product: "Menu boards", status: "NEGOTIATION", confirmed: true }, won.version);
    expect(reopened.closedAt).toBeNull();
  });

  it("stale versions are rejected", async () => {
    const lead = await newLead("Version Bar");
    const o = await opps.saveOpportunity(U.coordinator, null, { leadId: lead.id, product: "Ads" });
    await opps.saveOpportunity(U.coordinator, o.id, { leadId: lead.id, product: "Ads v2" }, o.version);
    await expect(opps.saveOpportunity(U.coordinator, o.id, { leadId: lead.id, product: "Ads v3" }, o.version)).rejects.toThrow(/changed by someone else/);
  });

  it("reps can't see or edit another rep's opportunities", async () => {
    const lead = await newLead("Other Rep Cafe", U.rep2.id);
    const o = await opps.saveOpportunity(U.rep2, null, { leadId: lead.id, product: "Loyalty app", estimatedValue: 100 });
    const visible = await q.listOpportunities(U.rep, {}, all);
    expect(visible.map((x) => x.id)).not.toContain(o.id);
    await expect(opps.saveOpportunity(U.rep, o.id, { leadId: lead.id, product: "Hijack" }, o.version)).rejects.toThrow();
    const repReport = await reports.salesReport(U.rep, {}, all);
    expect(repReport.summary.pipelineValue).not.toBe((await reports.salesReport(U.coordinator, {}, all)).summary.pipelineValue);
  });

  it("archived opportunities are excluded from totals", async () => {
    const before = (await reports.salesReport(U.coordinator, {}, all)).summary.revenue;
    const lead = await newLead("Archive Grill");
    const won = await opps.saveOpportunity(U.coordinator, null, { leadId: lead.id, product: "Kiosk", status: "WON", finalAmount: 1000, confirmed: true });
    expect((await reports.salesReport(U.coordinator, {}, all)).summary.revenue).toBe(before + 1000);
    await expect(opps.archiveOpportunity(U.rep, won.id, true)).rejects.toThrow();
    await opps.archiveOpportunity(U.coordinator, won.id, true);
    expect((await reports.salesReport(U.coordinator, {}, all)).summary.revenue).toBe(before);
  });
});
