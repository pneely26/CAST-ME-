import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TEST_URL, setupTestDb, makeUsers } from "./helpers";

describe.skipIf(!TEST_URL)("reminders, users, settings, demo (database)", () => {
  let prisma: PrismaClient;
  let U: Awaited<ReturnType<typeof makeUsers>>;
  let rem: typeof import("@/server/services/reminders");
  let users: typeof import("@/server/services/users");
  let settings: typeof import("@/server/services/settingsAdmin");
  let demo: typeof import("@/server/services/demo");
  let leads: typeof import("@/server/services/leads");
  let audit: typeof import("@/server/services/auditQuery");
  const H = 3_600_000;

  beforeAll(async () => {
    prisma = await setupTestDb();
    U = await makeUsers(prisma);
    rem = await import("@/server/services/reminders");
    users = await import("@/server/services/users");
    settings = await import("@/server/services/settingsAdmin");
    demo = await import("@/server/services/demo");
    leads = await import("@/server/services/leads");
    audit = await import("@/server/services/auditQuery");
  }, 120_000);

  it("reminders cover due, overdue and upcoming items and never repeat", async () => {
    const lead = await leads.createLead(U.coordinator, { businessName: "Reminder Cafe", phone: "3125550188", assignedRepId: U.rep.id });
    const now = new Date();
    await prisma.followUp.create({ data: { leadId: lead.id, dueAt: new Date(now.getTime() - 3 * 24 * H), action: "Call back", assignedToId: U.rep.id, createdById: U.coordinator.id } });
    await prisma.appointment.create({ data: { leadId: lead.id, repId: U.rep.id, createdById: U.coordinator.id, startAt: new Date(now.getTime() + H), endAt: new Date(now.getTime() + 2 * H) } });
    const first = await rem.runReminders(now);
    expect(first.followUpsOverdue).toBe(1);
    expect(first.appointmentsUpcoming).toBe(1);
    expect(await prisma.notification.count({ where: { userId: U.rep.id, type: "FOLLOW_UP_OVERDUE" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: U.coordinator.id, type: "FOLLOW_UP_OVERDUE" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: U.rep.id, type: "APPOINTMENT_UPCOMING" } })).toBe(1);
    const second = await rem.runReminders(now);
    expect(second.created).toBe(0); // idempotent
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: U.rep.id, type: "APPOINTMENT_UPCOMING" } });
    expect(n.channels).toEqual(["in_app"]); // nothing claimed outside the app
  });

  it("user management is coordinator-only and protects the last coordinator", async () => {
    await expect(users.createUser(U.rep, { name: "X", email: "x@test.example", role: "REP", password: "long-enough-pw" })).rejects.toThrow(/coordinator/);
    await expect(users.createUser(U.coordinator, { name: "Short", email: "s@test.example", role: "REP", password: "short" })).rejects.toThrow(/10 characters/);
    await expect(users.setUserActive(U.coordinator, U.coordinator.id, false)).rejects.toThrow(/your own/);
    const c2 = await users.createUser(U.coordinator, { name: "Second Coord", email: "c2@test.example", role: "COORDINATOR", password: "long-enough-pw" });
    await users.setUserActive(U.coordinator, c2.id, false);
    await expect(users.updateUser(U.coordinator, U.coordinator.id, { name: "Casey", email: "casey@test.example", role: "REP" })).rejects.toThrow(/own role/);
    await users.createUser(U.coordinator, { name: "Dana Rep", email: "dana@test.example", role: "REP", password: "long-enough-pw" });
    await expect(users.createUser(U.coordinator, { name: "Dup", email: "DANA@test.example", role: "REP", password: "long-enough-pw" })).rejects.toThrow(/already exists/);
  });

  it("deactivating or resetting a password invalidates existing sessions", async () => {
    const v0 = (await prisma.user.findUniqueOrThrow({ where: { id: U.rep2.id } })).sessionVersion;
    await users.resetPassword(U.coordinator, U.rep2.id, "brand-new-password");
    const v1 = (await prisma.user.findUniqueOrThrow({ where: { id: U.rep2.id } })).sessionVersion;
    expect(v1).toBe(v0 + 1);
    await users.setUserActive(U.coordinator, U.rep2.id, false);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: U.rep2.id } });
    expect(u.active).toBe(false);
    expect(u.sessionVersion).toBe(v1 + 1);
    await users.setUserActive(U.coordinator, U.rep2.id, true);
    await expect(users.changeOwnPassword(U.rep2, "wrong-password", "another-password-1")).rejects.toThrow(/incorrect/);
    const r = await users.changeOwnPassword(U.rep2, "brand-new-password", "another-password-1");
    expect(r.sessionVersion).toBeGreaterThan(u.sessionVersion);
  });

  it("settings are validated and audited", async () => {
    const base = { businessName: "Acme Sales", timezone: "America/Chicago", staleVisitDays: "21", defaultAppointmentMinutes: "30", duplicateAppointmentWindowMinutes: "120", reminderMinutesBefore: "60", weekStartsOn: "1" };
    await expect(settings.saveSettings(U.rep, base)).rejects.toThrow(/coordinator/);
    await expect(settings.saveSettings(U.coordinator, { ...base, timezone: "Mars/Olympus" })).rejects.toThrow(/time zone/);
    await expect(settings.saveSettings(U.coordinator, { ...base, staleVisitDays: "0" })).rejects.toThrow(/at least 1/);
    const s = await settings.saveSettings(U.coordinator, base);
    expect(s).toMatchObject({ businessName: "Acme Sales", staleVisitDays: 21, defaultAppointmentMinutes: 30 });
    expect(await prisma.auditLog.count({ where: { action: "settings.updated" } })).toBe(1);
  });

  it("demo data is labeled, counted separately, and removable without touching real records", async () => {
    const realLeads = await prisma.lead.count();
    const realVisits = await prisma.visit.count();
    const loaded = await demo.loadDemoData(U.coordinator);
    expect(loaded.leads).toBeGreaterThan(0);
    expect(await prisma.lead.count({ where: { isDemo: true, NOT: { businessName: { endsWith: "(demo)" } } } })).toBe(0);
    await expect(demo.loadDemoData(U.coordinator)).rejects.toThrow(/already loaded/);
    await expect(demo.removeDemoData(U.rep)).rejects.toThrow(/coordinator/);
    await demo.removeDemoData(U.coordinator);
    expect(await prisma.lead.count()).toBe(realLeads);
    expect(await prisma.visit.count()).toBe(realVisits);
    expect((await demo.demoStatus()).present).toBe(false);
    expect(await prisma.territory.count({ where: { name: "Demo Territory" } })).toBe(0);
    expect(await prisma.notification.count({ where: { OR: [{ title: { contains: "(demo)" } }, { body: { contains: "(demo)" } }] } })).toBe(0);
  });

  it("only the coordinator can read the audit log", async () => {
    const all = { preset: "all" as const, startKey: "1970-01-01", endKey: "2999-12-31", start: new Date(0), end: new Date(8.64e15), label: "All time" };
    await expect(audit.listAudit(U.rep, {}, all)).rejects.toThrow(/coordinator/);
    const r = await audit.listAudit(U.coordinator, { area: "users" }, all);
    expect(r.rows.every((x) => /^(user|settings|demo)\./.test(x.action))).toBe(true);
    expect(r.total).toBeGreaterThan(0);
  });
});
