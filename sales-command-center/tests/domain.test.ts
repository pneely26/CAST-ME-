import { describe, it, expect } from "vitest";
import { zonedToUtc, dateKeyInTz, timeInTz, weekStartKey, resolveRange, addDays, tzOffsetMinutes } from "@/lib/time";
import { normalizeBusinessName, normalizePhone, normalizeAddress, findDuplicates, formatPhone } from "@/lib/normalize";
import { computeRollups, suggestStatusAfterVisit, advanceStatus } from "@/lib/domain/rollups";
import { findConflicts, findDuplicate, validateTimes, canResolve } from "@/lib/domain/appointments";
import { resolveWeek, differsFromTemplate } from "@/lib/domain/schedule";
import { summarizeSales, conversionRate, computeCommission } from "@/lib/domain/sales";
import { can, leadScope, assertLeadAccess, type Actor } from "@/server/policy";

const TZ = "America/Chicago";

describe("time zones (Chicago default)", () => {
  it("converts local wall time to UTC across DST", () => {
    expect(zonedToUtc("2026-07-15", "09:00", TZ).toISOString()).toBe("2026-07-15T14:00:00.000Z"); // CDT -5
    expect(zonedToUtc("2026-01-15", "09:00", TZ).toISOString()).toBe("2026-01-15T15:00:00.000Z"); // CST -6
    expect(zonedToUtc("2026-03-08", "03:30", TZ).toISOString()).toBe("2026-03-08T08:30:00.000Z"); // first CDT morning
    expect(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), TZ)).toBe(-300);
  });
  it("finds the local date/time of an instant", () => {
    const late = new Date("2026-10-16T04:30:00Z"); // 11:30 PM Oct 15 in Chicago
    expect(dateKeyInTz(late, TZ)).toBe("2026-10-15");
    expect(timeInTz(late, TZ)).toBe("23:30");
  });
  it("week and month ranges", () => {
    expect(weekStartKey("2026-10-16")).toBe("2026-10-12"); // Friday -> Monday
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    const r = resolveRange("month", undefined, undefined, TZ, new Date("2026-02-10T18:00:00Z"));
    expect([r.startKey, r.endKey]).toEqual(["2026-02-01", "2026-02-28"]);
    const c = resolveRange("custom", "2026-10-01", "2026-10-05", TZ);
    expect(c.start.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(c.end.toISOString()).toBe("2026-10-06T05:00:00.000Z");
  });
});

describe("normalization & duplicate detection", () => {
  it("normalizes names, phones and addresses", () => {
    expect(normalizeBusinessName("The Joe's Pizza & Grill, LLC")).toBe("joes pizza and grill");
    expect(normalizePhone("+1 (312) 555-0100")).toBe("3125550100");
    expect(formatPhone("3125550100")).toBe("(312) 555-0100");
    expect(normalizeAddress("123 North Main Street, Suite 4", "60601-1234")).toBe("123 n main st 60601");
  });
  it("flags likely duplicates using name, phone and address", () => {
    const existing = [
      { id: "a", normalizedName: "joes pizza and grill", normalizedPhone: "3125550100", normalizedAddress: "123 n main st 60601", email: null },
      { id: "b", normalizedName: "acme hardware", normalizedPhone: "7735550199", normalizedAddress: "9 w lake st 60606", email: "info@acme.test" },
    ];
    const m = findDuplicates({ businessName: "Joe's Pizza and Grill Inc", phone: "312.555.0100", address: "123 N. Main St" , zip: "60601"}, existing);
    expect(m[0].id).toBe("a");
    expect(m[0].reasons).toEqual(expect.arrayContaining(["Same business name", "Same phone number", "Same address"]));
    expect(findDuplicates({ businessName: "Different Co", phone: "7735550199" }, existing)[0].id).toBe("b"); // phone alone
    expect(findDuplicates({ businessName: "Totally New Bakery", phone: "2225550000" }, existing)).toHaveLength(0);
  });
});

describe("lead rollups & status automation", () => {
  const now = new Date("2026-10-16T15:00:00Z");
  it("derives last visit / contact / feedback from full history without losing older visits", () => {
    const r = computeRollups({
      visits: [
        { visitAt: new Date("2026-10-01T15:00:00Z"), type: "WALK_IN", outcome: "LEFT_INFORMATION", feedback: "Left brochure" },
        { visitAt: new Date("2026-10-10T15:00:00Z"), type: "WALK_IN", outcome: "INTERESTED", feedback: "Owner liked it" },
        { visitAt: new Date("2026-10-12T15:00:00Z"), type: "PHONE_CALL", outcome: "REQUESTED_CALLBACK", feedback: "" },
      ],
      openFollowUpDue: [new Date("2026-10-20T15:00:00Z"), new Date("2026-10-14T15:00:00Z")],
      activeAppointmentStarts: [new Date("2026-10-01T15:00:00Z"), new Date("2026-10-22T15:00:00Z")],
      plannedStopDates: [],
      now,
    });
    expect(r.lastVisitAt?.toISOString()).toBe("2026-10-10T15:00:00.000Z"); // phone call isn't a visit
    expect(r.lastContactAt?.toISOString()).toBe("2026-10-12T15:00:00.000Z");
    expect(r.visitCount).toBe(2);
    expect(r.lastVisitOutcome).toBe("INTERESTED");
    expect(r.latestFeedback).toBe("Owner liked it");
    expect(r.nextFollowUpAt?.toISOString()).toBe("2026-10-14T15:00:00.000Z"); // overdue one first
    expect(r.nextAppointmentAt?.toISOString()).toBe("2026-10-22T15:00:00.000Z"); // past ones ignored
  });
  it("suggests forward-only statuses and never changes closed leads", () => {
    expect(suggestStatusAfterVisit("NEW", { type: "WALK_IN", outcome: "LEFT_INFORMATION", hasFollowUp: false, bookedAppointment: false })).toBe("VISITED");
    expect(suggestStatusAfterVisit("NEW", { type: "WALK_IN", outcome: "REQUESTED_CALLBACK", hasFollowUp: true, bookedAppointment: false })).toBe("FOLLOW_UP_REQUIRED");
    expect(suggestStatusAfterVisit("VISITED", { type: "WALK_IN", outcome: "INTERESTED", hasFollowUp: true, bookedAppointment: false })).toBe("INTERESTED");
    expect(suggestStatusAfterVisit("OPPORTUNITY_IN_PROGRESS", { type: "WALK_IN", outcome: "LEFT_INFORMATION", hasFollowUp: false, bookedAppointment: false })).toBe("OPPORTUNITY_IN_PROGRESS");
    expect(suggestStatusAfterVisit("DO_NOT_CONTACT", { type: "WALK_IN", outcome: "INTERESTED", hasFollowUp: false, bookedAppointment: false })).toBe("DO_NOT_CONTACT");
    expect(suggestStatusAfterVisit("NEW", { type: "PHONE_CALL", outcome: "DECISION_MAKER_UNAVAILABLE", hasFollowUp: false, bookedAppointment: false })).toBe("CONTACT_ATTEMPTED");
    expect(suggestStatusAfterVisit("NEW", { type: "WALK_IN", outcome: "OTHER", hasFollowUp: false, bookedAppointment: true })).toBe("APPOINTMENT_SCHEDULED");
    expect(advanceStatus("WON", "VISITED")).toBe("WON");
  });
});

describe("appointments", () => {
  const appts = [
    { id: "1", leadId: "L1", repId: "R", startAt: new Date("2026-10-20T15:00:00Z"), endAt: new Date("2026-10-20T16:00:00Z"), status: "SCHEDULED" as const },
    { id: "2", leadId: "L2", repId: "R", startAt: new Date("2026-10-20T18:00:00Z"), endAt: new Date("2026-10-20T19:00:00Z"), status: "CANCELED" as const },
  ];
  it("detects overlapping appointments for the same rep (ignores canceled)", () => {
    expect(findConflicts({ repId: "R", startAt: new Date("2026-10-20T15:30:00Z"), endAt: new Date("2026-10-20T16:30:00Z") }, appts).map((a) => a.id)).toEqual(["1"]);
    expect(findConflicts({ repId: "R", startAt: new Date("2026-10-20T18:00:00Z"), endAt: new Date("2026-10-20T18:30:00Z") }, appts)).toHaveLength(0);
    expect(findConflicts({ repId: "R", startAt: new Date("2026-10-20T16:00:00Z"), endAt: new Date("2026-10-20T17:00:00Z") }, appts)).toHaveLength(0); // back-to-back is fine
  });
  it("treats a second active appointment for the same lead near the same time as a duplicate", () => {
    expect(findDuplicate({ leadId: "L1", startAt: new Date("2026-10-20T16:30:00Z") }, appts, 180)?.id).toBe("1");
    expect(findDuplicate({ leadId: "L1", startAt: new Date("2026-10-21T16:30:00Z") }, appts, 180)).toBeNull();
    expect(findDuplicate({ id: "1", leadId: "L1", startAt: new Date("2026-10-20T15:00:00Z") }, appts, 180)).toBeNull(); // itself
  });
  it("validates times and reschedule transitions", () => {
    expect(validateTimes(new Date("2026-10-20T16:00:00Z"), new Date("2026-10-20T15:00:00Z"))).toMatch(/after/);
    expect(canResolve("PENDING", "approve")).toBe(true);
    expect(canResolve("APPROVED", "approve")).toBe(false);
    expect(canResolve("DECLINED", "edit")).toBe(false);
  });
});

describe("weekly territory plan", () => {
  const template = [
    { id: "t1", weekday: 1, label: "Area A", territoryId: "T", areaId: "A", startTime: "09:00", endTime: "17:00", visitTarget: 12, notes: null },
    { id: "t5", weekday: 5, label: "Follow-ups", territoryId: null, areaId: null, startTime: "10:00", endTime: "15:00", visitTarget: 6, notes: null },
  ];
  it("uses the template unless a specific date has its own plan (override)", () => {
    const plans = [{ id: "p", date: "2026-10-19", label: "Area C instead", territoryId: "T", areaId: "C", startTime: "09:00", endTime: "17:00", visitTarget: 10, routeNotes: null, status: "PLANNED", isOverride: true }];
    const wk = resolveWeek("2026-10-12", 14, template, plans);
    expect(wk[0]).toMatchObject({ date: "2026-10-12", source: "template", areaId: "A" });
    expect(wk[4]).toMatchObject({ date: "2026-10-16", source: "template", label: "Follow-ups" });
    expect(wk[1].source).toBe("none");
    expect(wk[7]).toMatchObject({ date: "2026-10-19", source: "plan", areaId: "C", isOverride: true }); // next Monday overridden only
    expect(differsFromTemplate(plans[0], template[0])).toBe(true);
  });
});

describe("sales math", () => {
  const base = { leadId: "L", repId: "R", product: "X", commissionAmount: null, openedAt: new Date("2026-09-01") };
  const opps = [
    { ...base, id: "1", status: "WON" as const, estimatedValue: 1000, finalAmount: 1200, closedAt: new Date("2026-10-05T12:00:00Z"), commissionAmount: 120 },
    { ...base, id: "1", status: "WON" as const, estimatedValue: 1000, finalAmount: 1200, closedAt: new Date("2026-10-05T12:00:00Z") }, // same record twice
    { ...base, id: "2", status: "WON" as const, estimatedValue: 500, finalAmount: 800, closedAt: new Date("2026-09-20T12:00:00Z") },
    { ...base, id: "3", status: "LOST" as const, estimatedValue: 900, finalAmount: null, closedAt: new Date("2026-10-07T12:00:00Z") },
    { ...base, id: "4", status: "NEGOTIATION" as const, estimatedValue: 2500, finalAmount: null, closedAt: null },
  ];
  it("counts only closed-won revenue, keeps pipeline separate, never double-counts", () => {
    const all = summarizeSales(opps);
    expect(all.revenue).toBe(2000);
    expect(all.wonCount).toBe(2);
    expect(all.pipelineValue).toBe(2500);
    const oct = summarizeSales(opps, { start: new Date("2026-10-01T05:00:00Z"), end: new Date("2026-11-01T05:00:00Z") });
    expect(oct).toMatchObject({ revenue: 1200, wonCount: 1, lostCount: 1, winRate: 0.5, commission: 120 });
  });
  it("conversion and commission", () => {
    expect(conversionRate(20, ["a", "b", "a"])).toBe(0.1);
    expect(conversionRate(0, [])).toBeNull();
    expect(computeCommission(1000, 0.1, null)).toBe(100);
    expect(computeCommission(1000, null, null)).toBeNull(); // no assumed rules
  });
});

describe("permission policy", () => {
  const coord: Actor = { id: "c", role: "COORDINATOR", name: "C" };
  const rep: Actor = { id: "r", role: "REP", name: "R" };
  it("restricts admin functions to the coordinator", () => {
    for (const p of ["users.manage", "settings.manage", "lead.archive", "lead.assign", "lead.import", "reschedule.resolve", "appointment.moveDirect", "audit.view"] as const) {
      expect(can(coord, p)).toBe(true);
      expect(can(rep, p)).toBe(false);
    }
  });
  it("scopes reps to their assigned leads", () => {
    expect(leadScope(rep)).toEqual({ assignedRepId: "r" });
    expect(leadScope(coord)).toEqual({});
    expect(() => assertLeadAccess(rep, { assignedRepId: "someone-else" })).toThrow(/isn't assigned/);
    expect(() => assertLeadAccess(rep, { assignedRepId: "r" })).not.toThrow();
  });
});
