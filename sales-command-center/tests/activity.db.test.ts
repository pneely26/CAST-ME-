import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TEST_URL, setupTestDb, makeUsers } from "./helpers";
import { describeDevice } from "@/lib/device";

describe("device names", () => {
  it("summarizes common browsers", () => {
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Windows PC · Edge");
    expect(describeDevice(null)).toBe("Unknown device");
  });
});

describe.skipIf(!TEST_URL)("rep activity log (database)", () => {
  let prisma: PrismaClient;
  let U: Awaited<ReturnType<typeof makeUsers>>;
  let act: typeof import("@/server/services/activity");
  const all = { preset: "all" as const, startKey: "1970-01-01", endKey: "2999-12-31", start: new Date(0), end: new Date(8.64e15), label: "All time" };

  beforeAll(async () => {
    prisma = await setupTestDb();
    U = await makeUsers(prisma);
    act = await import("@/server/services/activity");
  }, 120_000);

  it("groups sign-ins and page views into sessions with plain descriptions", async () => {
    const lead = await prisma.lead.create({ data: { businessName: "Activity Test Diner", normalizedName: "activity test diner", assignedRepId: U.rep.id } });
    const t0 = new Date("2026-10-19T13:00:00Z").getTime();
    const at = (min: number) => new Date(t0 + min * 60_000);
    await prisma.auditLog.create({ data: { actorId: U.rep.id, action: "auth.login", entityType: "User", summary: "Signed in · iPhone · Safari", data: { device: "iPhone · Safari" }, createdAt: at(0) } });
    await prisma.pageView.createMany({
      data: [
        { userId: U.rep.id, path: "/today", device: "iPhone · Safari", createdAt: at(1) },
        { userId: U.rep.id, path: `/leads/${lead.id}?tab=visits`, device: "iPhone · Safari", createdAt: at(3) },
        { userId: U.rep.id, path: "/leads?q=pizza", device: "iPhone · Safari", createdAt: at(5) },
        // came back two hours later without signing in again → a new session
        { userId: U.rep.id, path: "/appointments", device: "iPhone · Safari", createdAt: at(125) },
      ],
    });
    const r = await act.repActivity(U.coordinator, U.rep.id, all);
    expect(r.totals).toMatchObject({ signIns: 1, sessions: 2, pages: 4 });
    const [latest, first] = r.sessions;
    expect(first.events.map((e) => e.text)).toEqual(["Signed in · iPhone · Safari", "Opened Today's route", "Viewed lead Activity Test Diner — visit history", "Searched leads for “pizza”"]);
    expect(first.events[2].href).toBe(`/leads/${lead.id}`);
    expect(latest.events[0].text).toBe("Opened appointments");
    expect((await act.repLastSeen([U.rep.id])).get(U.rep.id)?.getTime()).toBe(at(125).getTime());
  });

  it("only the coordinator can see it", async () => {
    await expect(act.repActivity(U.rep, U.rep.id, all)).rejects.toThrow(/coordinator/);
  });
});
