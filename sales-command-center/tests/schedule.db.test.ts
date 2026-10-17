import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TEST_URL, setupTestDb, makeUsers } from "./helpers";
import { addDays, weekStartKey, dateKeyInTz, zonedToUtc } from "@/lib/time";

describe.skipIf(!TEST_URL)("schedule, appointments & reschedules (database)", () => {
  let prisma: PrismaClient;
  let U: Awaited<ReturnType<typeof makeUsers>>;
  let s: typeof import("@/server/services/schedule");
  let ap: typeof import("@/server/services/appointments");
  let rs: typeof import("@/server/services/reschedules");
  let leads: typeof import("@/server/services/leads");
  let visits: typeof import("@/server/services/visits");
  let areaA: string, areaB: string, areaC: string;
  const TZ = "America/Chicago";
  const nextMonday = addDays(weekStartKey(dateKeyInTz(new Date(), TZ)), 7);

  beforeAll(async () => {
    prisma = await setupTestDb();
    U = await makeUsers(prisma);
    s = await import("@/server/services/schedule");
    ap = await import("@/server/services/appointments");
    rs = await import("@/server/services/reschedules");
    leads = await import("@/server/services/leads");
    visits = await import("@/server/services/visits");
    const t = await prisma.territory.create({ data: { name: "North" } });
    areaA = (await prisma.area.create({ data: { territoryId: t.id, name: "Area A" } })).id;
    areaB = (await prisma.area.create({ data: { territoryId: t.id, name: "Area B" } })).id;
    areaC = (await prisma.area.create({ data: { territoryId: t.id, name: "Area C" } })).id;
  }, 120_000);

  it("recurring template + one-date override that doesn't change future weeks", async () => {
    await s.saveTemplate(U.coordinator, U.rep.id, [
      { weekday: 1, areaId: areaA, startTime: "09:00", endTime: "17:00", visitTarget: 12 },
      { weekday: 2, areaId: areaB },
      { weekday: 5, label: "Follow-ups and appointments" },
    ]);
    await s.saveDayPlan(U.coordinator, U.rep.id, nextMonday, { areaId: areaC, startTime: "09:00", endTime: "17:00", visitTarget: 12 });
    const wk1 = await s.getSchedule(U.coordinator, U.rep.id, nextMonday, 7);
    const wk2 = await s.getSchedule(U.coordinator, U.rep.id, addDays(nextMonday, 7), 7);
    expect(wk1[0]).toMatchObject({ areaId: areaC, isOverride: true, source: "plan" });
    expect(wk1[1]).toMatchObject({ areaId: areaB, source: "template" });
    expect(wk1[4]).toMatchObject({ label: "Follow-ups and appointments" });
    expect(wk2[0]).toMatchObject({ areaId: areaA, source: "template" }); // following Monday unaffected
    // reset brings it back
    await s.resetDayToTemplate(U.coordinator, U.rep.id, nextMonday);
    expect((await s.getSchedule(U.coordinator, U.rep.id, nextMonday, 1))[0]).toMatchObject({ areaId: areaA, isOverride: false });
  });

  it("assigning leads to a day: rep sees the plan, visiting marks the stop, lead shows next planned visit", async () => {
    const lead = await leads.createLead(U.coordinator, { businessName: "Route Stop Diner", assignedRepId: U.rep.id, areaId: areaA });
    const today = dateKeyInTz(new Date(), TZ);
    await s.addStops(U.coordinator, U.rep.id, today, [lead.id]);
    const repView = await s.getSchedule(U.rep, U.rep.id, today, 1);
    expect(repView[0].stops.map((x) => x.lead.id)).toContain(lead.id);
    await expect(s.getSchedule(U.rep2, U.rep.id, today, 1)).rejects.toThrow(); // other rep can't see it
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).nextPlannedVisit).not.toBeNull();
    await visits.recordVisit(U.coordinator, { leadId: lead.id, repId: U.rep.id, visitAt: new Date(), type: "WALK_IN", outcome: "LEFT_INFORMATION" });
    const stop = await prisma.dayPlanStop.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(stop.status).toBe("VISITED");
    expect(stop.visitId).not.toBeNull();
    // a rep can't put another rep's lead on their day
    const other = await leads.createLead(U.coordinator, { businessName: "Not Yours Grocery", assignedRepId: U.rep2.id });
    await expect(s.addStops(U.rep, null, today, [other.id])).rejects.toThrow();
  });

  it("F: reschedule request → approval moves the same appointment and keeps original time in history", async () => {
    const lead = await leads.createLead(U.coordinator, { businessName: "Reschedule Roasters", assignedRepId: U.rep.id });
    const start = zonedToUtc(addDays(nextMonday, 1), "10:00", TZ);
    const appt = await ap.createAppointment(U.coordinator, { leadId: lead.id, startAt: start, endAt: new Date(start.getTime() + 3_600_000) });
    // rep can't move directly
    await expect(ap.moveAppointment(U.rep, appt.id, new Date(start.getTime() + 86_400_000), new Date(start.getTime() + 90_000_000), "x")).rejects.toThrow(/request/);
    const newStart = zonedToUtc(addDays(nextMonday, 2), "14:00", TZ);
    // reps are view-only: they can't even request a change
    await expect(rs.requestReschedule(U.rep, { appointmentId: appt.id, requestedStart: newStart, requestedEnd: new Date(newStart.getTime() + 3_600_000), reason: "x" })).rejects.toThrow(/view-only/);
    const req = await rs.requestReschedule(U.coordinator, { appointmentId: appt.id, requestedStart: newStart, requestedEnd: new Date(newStart.getTime() + 3_600_000), reason: "Owner traveling Tuesday" });
    await expect(rs.requestReschedule(U.coordinator, { appointmentId: appt.id, requestedStart: newStart, requestedEnd: new Date(newStart.getTime() + 3_600_000), reason: "again" })).rejects.toThrow(/already a pending/);
    await expect(rs.resolveReschedule(U.rep, req.id, "approve")).rejects.toThrow(/coordinator/);
    await rs.resolveReschedule(U.coordinator, req.id, "approve", { notes: "OK" });
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id }, include: { changes: true } });
    expect(after.startAt.getTime()).toBe(newStart.getTime());
    expect(await prisma.appointment.count({ where: { leadId: lead.id } })).toBe(1); // no duplicate
    const moved = after.changes.find((c) => c.action === "MOVED")!;
    expect(moved.fromStart?.getTime()).toBe(start.getTime()); // original preserved
    expect(moved.rescheduleRequestId).toBe(req.id);
    expect((await prisma.rescheduleRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("APPROVED");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).nextAppointmentAt?.getTime()).toBe(newStart.getTime());
    await expect(rs.resolveReschedule(U.coordinator, req.id, "decline", { notes: "late" })).rejects.toThrow(/already approved/);
  });

  it("declined requests leave the appointment unchanged; canceled appointments stay in history", async () => {
    const lead = await leads.createLead(U.coordinator, { businessName: "Decline Dental", assignedRepId: U.rep.id });
    const start = zonedToUtc(addDays(nextMonday, 3), "11:00", TZ);
    const appt = await ap.createAppointment(U.coordinator, { leadId: lead.id, startAt: start, endAt: new Date(start.getTime() + 1_800_000) });
    const req = await rs.requestReschedule(U.coordinator, { appointmentId: appt.id, requestedStart: new Date(start.getTime() + 86_400_000), requestedEnd: new Date(start.getTime() + 88_200_000), reason: "Conflict" });
    await expect(rs.resolveReschedule(U.coordinator, req.id, "decline")).rejects.toThrow(/note/);
    await rs.resolveReschedule(U.coordinator, req.id, "decline", { notes: "They confirmed Thursday" });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).startAt.getTime()).toBe(start.getTime());
    await ap.setAppointmentStatus(U.coordinator, appt.id, "CANCELED", "Business closed early");
    const c = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id }, include: { changes: true } });
    expect(c.status).toBe("CANCELED");
    expect(c.changes.map((x) => x.action)).toEqual(expect.arrayContaining(["CREATED", "CANCELED"]));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).nextAppointmentAt).toBeNull();
  });
});
