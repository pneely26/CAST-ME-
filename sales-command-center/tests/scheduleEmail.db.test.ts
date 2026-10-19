import { describe, it, expect, beforeAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TEST_URL, setupTestDb, makeUsers } from "./helpers";
import { nextWorkDay } from "@/lib/time";

const sent: { to: string; subject: string; html: string; text: string }[] = [];
let configured = true;
vi.mock("@/server/email", () => ({
  emailStatus: () => ({ configured, from: "bc@example.com", host: "smtp.test" }),
  sendEmail: async (m: { to: string; subject: string; html: string; text: string }) => {
    sent.push(m);
  },
  appUrl: () => "https://app.example.com",
}));

describe("next work day", () => {
  it("is tomorrow, or Monday after a Friday when weekends are skipped", () => {
    expect(nextWorkDay("2026-10-15", true)).toBe("2026-10-16"); // Thu → Fri
    expect(nextWorkDay("2026-10-16", true)).toBe("2026-10-19"); // Fri → Mon
    expect(nextWorkDay("2026-10-16", false)).toBe("2026-10-17"); // Fri → Sat
  });
});

describe.skipIf(!TEST_URL)("schedule email + quick-appointment lead fields (database)", () => {
  let prisma: PrismaClient;
  let U: Awaited<ReturnType<typeof makeUsers>>;
  let se: typeof import("@/server/services/scheduleEmail");
  let leads: typeof import("@/server/services/leads");
  let appts: typeof import("@/server/services/appointments");
  const tz = "America/Chicago";
  const DAY = "2026-10-20"; // a Tuesday

  beforeAll(async () => {
    prisma = await setupTestDb();
    U = await makeUsers(prisma);
    await prisma.user.update({ where: { id: U.rep.id }, data: { email: "riley@example.com" } });
    await prisma.user.update({ where: { id: U.rep2.id }, data: { email: "sam@example.com" } });
    await prisma.appSetting.upsert({ where: { key: "timezone" }, create: { key: "timezone", value: tz }, update: { value: tz } });
    se = await import("@/server/services/scheduleEmail");
    leads = await import("@/server/services/leads");
    appts = await import("@/server/services/appointments");
  }, 120_000);

  it("saves every quick-appointment field and books an untimed, confirmed appointment", async () => {
    const lead = await leads.createLead(U.coordinator, {
      businessName: "GVJ Construction <LLC>", externalId: "218270127", assignedRepId: U.rep.id, contactName: "Victor Ramierez", jobTitle: "Owner",
      address: "711 Big Hill Ave", address2: "Suite 2", city: "Richmond", state: "KY", zip: "40475", country: "USA", phone: "(859) 310-8750", cellPhone: "859-555-0101",
      notes: "Talked to Victor owner.\nSet apt for 12pm MONDAY! SOLID", employeeCount: "5", businessVolume: "1.50", industry: "Construction Company", problems: "---", yearsInBusiness: "25",
      bcName: "Paige Floyd-Burnett", bcNumber: "104040", bcCoDirector1: "John J. Demko", bcCoDirector2: "Lucas J. Neuhaus",
    });
    expect(lead).toMatchObject({ address2: "Suite 2", cellPhone: "859-555-0101", businessVolume: "1.50", yearsInBusiness: 25, bcNumber: "104040", bcCoDirector2: "Lucas J. Neuhaus", country: "USA" });
    await expect(leads.createLead(U.coordinator, { businessName: "Bad Volume Co", businessVolume: "a lot" })).rejects.toThrow(/Business volume/);

    const { dayRangeUtc, zonedToUtc } = await import("@/lib/time");
    const { start, end } = dayRangeUtc(DAY, DAY, tz);
    const a = await appts.createAppointment(U.coordinator, { leadId: lead.id, repId: U.rep.id, startAt: start, endAt: end, timeSet: false, allowOverlap: true, confirmed: true, confirmedBy: "Nicole Olson" });
    expect(a).toMatchObject({ timeSet: false, status: "CONFIRMED", confirmedBy: "Nicole Olson" });

    // a timed one later the same day, a canceled one (left out), and a planned visit
    const other = await leads.createLead(U.coordinator, { businessName: "Second Stop Co", assignedRepId: U.rep.id, phone: "8595550199" });
    const noon = zonedToUtc(DAY, "12:00", tz);
    await appts.createAppointment(U.coordinator, { leadId: other.id, repId: U.rep.id, startAt: noon, endAt: new Date(noon.getTime() + 45 * 60_000) });
    const gone = await leads.createLead(U.coordinator, { businessName: "Canceled Co", assignedRepId: U.rep.id, phone: "8595550177" });
    const c = await appts.createAppointment(U.coordinator, { leadId: gone.id, repId: U.rep.id, startAt: zonedToUtc(DAY, "15:00", tz), endAt: zonedToUtc(DAY, "15:45", tz) });
    await prisma.appointment.update({ where: { id: c.id }, data: { status: "CANCELED" } });
    const visit = await leads.createLead(U.coordinator, { businessName: "Drop-in Diner", assignedRepId: U.rep.id, phone: "8595550166" });
    const plan = await prisma.dayPlan.create({ data: { repId: U.rep.id, date: DAY, routeNotes: "Richmond loop" } });
    await prisma.dayPlanStop.create({ data: { dayPlanId: plan.id, leadId: visit.id } });

    const s = await se.repSchedule(U.rep.id, DAY);
    expect(s.items.map((i) => [i.lead.businessName, i.kind])).toEqual([["Second Stop Co", "appointment"], ["GVJ Construction <LLC>", "appointment"], ["Drop-in Diner", "visit"]]);
    expect(s.items[1]).toMatchObject({ when: "No set time", status: "Confirmed", confirmedBy: "Nicole Olson" });

    const m = se.renderScheduleEmail("Riley Rep", DAY, s, "Sales Command Center");
    expect(m.subject).toMatch(/Tuesday, October 20, 2026 — 3 stops/);
    expect(m.html).toContain("GVJ Construction &lt;LLC&gt;");
    expect(m.html).not.toContain("<LLC>");
    for (const v of ["218270127", "Victor Ramierez, Owner", "711 Big Hill Ave, Suite 2", "Construction Company", "1.50", "Set apt for 12pm MONDAY! SOLID", "Richmond loop", "https://app.example.com/leads/"]) expect(m.html).toContain(v);
    expect(m.text).toContain("Business Volume ($ millions): 1.50");
  });

  it("sends only to reps with something scheduled, coordinator only, and says so when email isn't set up", async () => {
    sent.length = 0;
    await expect(se.sendScheduleEmails(U.rep, DAY)).rejects.toThrow(/coordinator/);
    const r = await se.sendScheduleEmails(U.coordinator, DAY);
    expect(r.map((x) => [x.repName, x.status])).toEqual([["Riley Rep", "sent"], ["Sam Second", "skipped"]]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("riley@example.com");
    expect(await prisma.auditLog.count({ where: { action: "email.schedule" } })).toBe(1);
    configured = false;
    await expect(se.sendScheduleEmails(U.coordinator, DAY)).rejects.toThrow(/isn't set up/);
    await expect(se.saveScheduleEmailSettings(U.coordinator, { enabled: true, time: "17:00", skipWeekends: true })).rejects.toThrow(/Set up email/);
    configured = true;
  });

  it("sends automatically once a day after the chosen time, and not on weekends when Friday covers Monday", async () => {
    sent.length = 0;
    const { zonedToUtc } = await import("@/lib/time");
    await se.saveScheduleEmailSettings(U.coordinator, { enabled: true, time: "17:00", skipWeekends: true });
    expect(await se.maybeSendScheduledEmails(zonedToUtc("2026-10-19", "16:59", tz))).toBeNull(); // Monday, too early
    const run = await se.maybeSendScheduledEmails(zonedToUtc("2026-10-19", "17:05", tz));
    expect(run?.date).toBe(DAY);
    expect(sent).toHaveLength(1);
    expect(await se.maybeSendScheduledEmails(zonedToUtc("2026-10-19", "17:10", tz))).toBeNull(); // already sent today
    expect(await se.maybeSendScheduledEmails(zonedToUtc("2026-10-24", "18:00", tz))).toBeNull(); // Saturday
    expect(sent).toHaveLength(1);
  });
});
