import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TEST_URL, setupTestDb, wipe } from "./helpers";

describe.skipIf(!TEST_URL)("first-start bootstrap (database)", () => {
  let prisma: PrismaClient;
  let boot: typeof import("@/server/bootstrap");
  const saved = { ...process.env };

  beforeAll(async () => {
    prisma = await setupTestDb();
    boot = await import("@/server/bootstrap");
  }, 120_000);
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (k.startsWith("BOOTSTRAP_")) delete process.env[k];
    Object.assign(process.env, Object.fromEntries(Object.entries(saved).filter(([k]) => k.startsWith("BOOTSTRAP_"))));
  });

  it("does nothing without settings or with a short password", async () => {
    await wipe(prisma);
    await boot.bootstrapIfEmpty();
    process.env.BOOTSTRAP_ADMIN_EMAIL = "a@example.com";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "short";
    await boot.bootstrapIfEmpty();
    expect(await prisma.user.count()).toBe(0);
  });

  it("creates the coordinator, demo rep and labeled demo data once, only on an empty database", async () => {
    await wipe(prisma);
    Object.assign(process.env, { BOOTSTRAP_ADMIN_EMAIL: "Owner@Example.com", BOOTSTRAP_ADMIN_PASSWORD: "long-enough-pass", BOOTSTRAP_DEMO: "true" });
    await boot.bootstrapIfEmpty();
    const users = await prisma.user.findMany({ orderBy: { role: "asc" } });
    expect(users.map((u) => [u.role, u.email])).toEqual([["COORDINATOR", "owner@example.com"], ["REP", "demo-rep@example.com"]]);
    const leads = await prisma.lead.count();
    expect(leads).toBeGreaterThan(0);
    expect(await prisma.lead.count({ where: { isDemo: false } })).toBe(0);
    await boot.bootstrapIfEmpty(); // a restart changes nothing
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.lead.count()).toBe(leads);
  });
});
