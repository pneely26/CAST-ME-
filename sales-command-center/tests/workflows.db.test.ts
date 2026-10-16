import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TEST_URL, setupTestDb, makeUsers } from "./helpers";

describe.skipIf(!TEST_URL)("connected workflows (database)", () => {
  let prisma: PrismaClient;
  let U: Awaited<ReturnType<typeof makeUsers>>;
  let svc: {
    leads: typeof import("@/server/services/leads");
    visits: typeof import("@/server/services/visits");
    appts: typeof import("@/server/services/appointments");
    fu: typeof import("@/server/services/followups");
  };
  const H = 3_600_000;
  const future = (h: number) => new Date(Date.now() + h * H);

  beforeAll(async () => {
    prisma = await setupTestDb();
    U = await makeUsers(prisma);
    svc = {
      leads: await import("@/server/services/leads"),
      visits: await import("@/server/services/visits"),
      appts: await import("@/server/services/appointments"),
      fu: await import("@/server/services/followups"),
    };
  }, 120_000);

  async function newLead(name: string, repId: string | null = U.rep.id) {
    return svc.leads.createLead(U.coordinator, { businessName: name, phone: `312555${Math.floor(1000 + Math.random() * 8999)}`, assignedRepId: repId });
  }

  it("B: assigning a lead puts it in the rep's assigned leads and notifies them", async () => {
    const lead = await newLead("Assign Test Bakery", null);
    await svc.leads.assignLeads(U.coordinator, [lead.id], U.rep.id);
    const mine = await prisma.lead.findMany({ where: { assignedRepId: U.rep.id } });
    expect(mine.map((l) => l.id)).toContain(lead.id);
    expect(await prisma.leadAssignment.count({ where: { leadId: lead.id, repId: U.rep.id, unassignedAt: null } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: U.rep.id, type: "LEAD_ASSIGNED" } })).toBeGreaterThan(0);
  });

  it("D/E: completing visits keeps full history, updates last-visited info and creates follow-ups", async () => {
    const lead = await newLead("Visit History Cafe");
    const t1 = new Date(Date.now() - 48 * H);
    const t2 = new Date(Date.now() - 2 * H);
    await svc.visits.recordVisit(U.rep, { leadId: lead.id, visitAt: t1, type: "WALK_IN", outcome: "LEFT_INFORMATION", feedback: "Left a brochure with the cashier" });
    await svc.visits.recordVisit(U.rep, { leadId: lead.id, visitAt: t2, type: "WALK_IN", outcome: "INTERESTED", feedback: "Owner wants pricing", followUpAction: "Send pricing", followUpDueAt: future(24) });
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(await prisma.visit.count({ where: { leadId: lead.id } })).toBe(2); // both preserved
    expect(l.lastVisitAt?.getTime()).toBe(t2.getTime());
    expect(l.latestFeedback).toBe("Owner wants pricing");
    expect(l.lastVisitOutcome).toBe("INTERESTED");
    expect(l.visitCount).toBe(2);
    expect(l.status).toBe("INTERESTED");
    expect(l.nextFollowUpAt).not.toBeNull();
    const fu = await prisma.followUp.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(fu).toMatchObject({ action: "Send pricing", assignedToId: U.rep.id, status: "OPEN" });
    // coordinator was told about the feedback
    expect(await prisma.notification.count({ where: { userId: U.coordinator.id, type: "NEW_FEEDBACK" } })).toBe(2);
    // timeline has entries
    expect(await prisma.auditLog.count({ where: { leadId: lead.id, action: "visit.recorded" } })).toBe(2);
  });

  it("a resubmitted visit form (same client key) does not create a second visit", async () => {
    const lead = await newLead("Double Tap Deli");
    const input = { leadId: lead.id, visitAt: new Date(), type: "WALK_IN" as const, outcome: "LEFT_INFORMATION" as const, clientKey: "key-123" };
    const a = await svc.visits.recordVisit(U.rep, input);
    const b = await svc.visits.recordVisit(U.rep, input);
    expect(a.id).toBe(b.id);
    expect(await prisma.visit.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("C/H: a booked appointment shows on the lead; duplicates are blocked; overlaps need confirmation", async () => {
    const lead = await newLead("Appointment Hardware");
    const other = await newLead("Overlap Optics");
    const appt = await svc.appts.createAppointment(U.coordinator, { leadId: lead.id, startAt: future(30), endAt: future(31) });
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.nextAppointmentAt?.getTime()).toBe(appt.startAt.getTime());
    expect(l.status).toBe("APPOINTMENT_SCHEDULED");
    await expect(svc.appts.createAppointment(U.coordinator, { leadId: lead.id, startAt: future(30.5), endAt: future(31.5) })).rejects.toThrow(/already has an active appointment/);
    await expect(svc.appts.createAppointment(U.coordinator, { leadId: other.id, startAt: future(30.5), endAt: future(31.5) })).rejects.toThrow(/Time conflict/);
    const ok = await svc.appts.createAppointment(U.coordinator, { leadId: other.id, startAt: future(30.5), endAt: future(31.5), allowOverlap: true });
    expect(ok.id).toBeTruthy();
  });

  it("J: Do Not Contact cancels open follow-ups, blocks new appointments, keeps history", async () => {
    const lead = await newLead("No Thanks Nails");
    await svc.visits.recordVisit(U.rep, { leadId: lead.id, visitAt: new Date(), type: "WALK_IN", outcome: "REQUESTED_CALLBACK", followUpAction: "Call back", followUpDueAt: future(48) });
    await svc.leads.setLeadStatus(U.coordinator, lead.id, "DO_NOT_CONTACT");
    expect(await prisma.followUp.count({ where: { leadId: lead.id, status: "OPEN" } })).toBe(0);
    expect(await prisma.followUp.count({ where: { leadId: lead.id, status: "CANCELED" } })).toBe(1);
    expect(await prisma.visit.count({ where: { leadId: lead.id } })).toBe(1);
    await expect(svc.appts.createAppointment(U.coordinator, { leadId: lead.id, startAt: future(80), endAt: future(81) })).rejects.toThrow(/Do Not Contact/);
    await expect(svc.fu.createFollowUp(U.coordinator, { leadId: lead.id, dueAt: future(10), action: "x" })).rejects.toThrow(/Do Not Contact/);
    // automation never moves it out of Do Not Contact
    await svc.visits.recordVisit(U.coordinator, { leadId: lead.id, repId: U.rep.id, visitAt: new Date(), type: "PHONE_CALL", outcome: "INTERESTED" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("DO_NOT_CONTACT");
  });

  it("server-side permissions: reps are limited to their own leads and allowed fields", async () => {
    const mine = await newLead("Rep One Shop", U.rep.id);
    const theirs = await newLead("Rep Two Shop", U.rep2.id);
    await expect(svc.visits.recordVisit(U.rep, { leadId: theirs.id, visitAt: new Date(), type: "WALK_IN", outcome: "OTHER" })).rejects.toThrow(/isn't assigned to you/);
    await expect(svc.leads.updateLead(U.rep, mine.id, { businessName: "Renamed" })).rejects.toThrow(/can't change/);
    await expect(svc.leads.archiveLeads(U.rep, [mine.id], true)).rejects.toThrow(/coordinator/);
    await expect(svc.leads.assignLeads(U.rep, [mine.id], U.rep.id)).rejects.toThrow(/coordinator/);
    await expect(svc.leads.createLead(U.rep, { businessName: "Sneaky" })).rejects.toThrow(/coordinator/);
    await expect(svc.appts.setAppointmentStatus(U.rep, (await svc.appts.createAppointment(U.rep, { leadId: mine.id, startAt: future(200), endAt: future(201) })).id, "CANCELED", "nah")).rejects.toThrow(/can't cancel/);
    const updated = await svc.leads.updateLead(U.rep, mine.id, { phone: "773-555-0142", status: "CONTACT_ATTEMPTED" });
    expect(updated.normalizedPhone).toBe("7735550142");
  });

  it("concurrent edits: a stale version is rejected instead of overwriting", async () => {
    const lead = await newLead("Version Check Co");
    await svc.leads.updateLead(U.coordinator, lead.id, { notes: "first" }, lead.version);
    await expect(svc.leads.updateLead(U.coordinator, lead.id, { notes: "stale" }, lead.version)).rejects.toThrow(/changed by someone else/);
  });

  it("archiving keeps history and restoring brings it back", async () => {
    const lead = await newLead("Archive Me Inc");
    await svc.visits.recordVisit(U.rep, { leadId: lead.id, visitAt: new Date(), type: "WALK_IN", outcome: "LEFT_INFORMATION" });
    await svc.leads.archiveLeads(U.coordinator, [lead.id], true);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).archivedAt).not.toBeNull();
    expect(await prisma.visit.count({ where: { leadId: lead.id } })).toBe(1);
    await expect(svc.visits.recordVisit(U.rep, { leadId: lead.id, visitAt: new Date(), type: "WALK_IN", outcome: "OTHER" })).rejects.toThrow(/not found/);
    await svc.leads.archiveLeads(U.coordinator, [lead.id], false);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).archivedAt).toBeNull();
  });
});
