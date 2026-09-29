/**
 * Database integration test for blind-spot persistence.
 * Runs only when TEST_DATABASE_URL is set. The database name must end in "_test" —
 * all rows in it are deleted before the run.
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/stewart_blind_spot_test npm test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("blind spot detection with database", () => {
  let mod: {
    prisma: typeof import("@/lib/server/db").prisma;
    createBreakdown: typeof import("@/lib/server/records").createBreakdown;
    runDetection: typeof import("@/lib/server/detection").runDetection;
    rerunUnreviewed: typeof import("@/lib/server/detection").rerunUnreviewed;
    resolveBlindSpot: typeof import("@/lib/server/detection").resolveBlindSpot;
  };

  beforeAll(async () => {
    if (!new URL(url!).pathname.slice(1).endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
    process.env.DATABASE_URL = url;
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
    const db = await import("@/lib/server/db");
    const p = db.prisma;
    for (const m of [p.webFinding, p.webSource, p.alert, p.auditLog, p.watchlistItem, p.blindSpot, p.agencySubmission, p.publicBreakdown, p.projectCasting, p.project, p.castingDirector, p.importBatch, p.sourceRun]) {
      await (m as unknown as { deleteMany: () => Promise<unknown> }).deleteMany();
    }
    const records = await import("@/lib/server/records");
    const detection = await import("@/lib/server/detection");
    mod = { prisma: db.prisma, createBreakdown: records.createBreakdown, ...detection };
  }, 120_000);

  afterAll(async () => {
    await mod?.prisma.$disconnect();
  });

  async function submit(title: string, extra: Record<string, unknown> = {}) {
    const { normalizedTitleString } = await import("@/lib/normalize");
    return mod.prisma.agencySubmission.create({ data: { projectTitleRaw: title, normalizedTitle: normalizedTitleString(title), ...extra } });
  }

  it("creates an agency-only project for a not-found submission, then resolves it when a public listing arrives", async () => {
    const s = await submit("Iron & Velvet", { role: "Tasha", castingDirectorRaw: "Rosa Grant", platform: "HBO", region: "LOS_ANGELES", dateSubmitted: new Date() });
    const bs1 = await mod.runDetection(s.id);
    expect(bs1.classification).toBe("AGENCY_REPORTED_NOT_FOUND");
    const agencyProject = await mod.prisma.project.findUniqueOrThrow({ where: { id: bs1.projectId } });
    expect(agencyProject.agencyReported).toBe(true);
    expect(await mod.prisma.auditLog.count({ where: { action: "BLIND_SPOT_CREATED" } })).toBe(1);

    await mod.createBreakdown({ project: "Iron and Velvet", platform: "HBO", region: "LOS_ANGELES", castingDirector: "Rosa Grant, CSA", roleName: "Tasha", source: "Test", postedDate: new Date() });
    await mod.rerunUnreviewed();
    const bs2 = await mod.prisma.blindSpot.findUniqueOrThrow({ where: { id: bs1.id } });
    expect(bs2.classification).toBe("PUBLIC_MATCH");
    // orphaned agency-only project is cleaned up
    expect(await mod.prisma.project.findUnique({ where: { id: agencyProject.id } })).toBeNull();
    expect(await mod.prisma.auditLog.count({ where: { action: "BLIND_SPOT_RESOLVED" } })).toBe(1);
  });

  it("keeps uncertain matches separate until the user confirms", async () => {
    await mod.createBreakdown({ project: "Last Summer", platform: "Hulu", castingDirector: "Tom Becker", source: "Test" });
    const s = await submit("The Last Summer", { platform: "Netflix", castingDirectorRaw: "Ann Ruiz" });
    const bs = await mod.runDetection(s.id);
    expect(bs.classification).toBe("NEEDS_REVIEW");
    const sub = await mod.prisma.agencySubmission.findUniqueOrThrow({ where: { id: s.id } });
    expect(sub.projectId).not.toBe(bs.candidateProjectId); // not merged

    await mod.resolveBlindSpot(bs.id, "SAME_AS_CANDIDATE");
    const after = await mod.prisma.blindSpot.findUniqueOrThrow({ where: { id: bs.id } });
    expect(after.reviewStatus).toBe("CONFIRMED_PUBLIC");
    expect((await mod.prisma.agencySubmission.findUniqueOrThrow({ where: { id: s.id } })).projectId).toBe(bs.candidateProjectId);
  });

  it("does not overwrite human-reviewed results on re-run", async () => {
    const s = await submit("Glass Houses", { castingDirectorRaw: "Lena Park" });
    const bs = await mod.runDetection(s.id);
    await mod.resolveBlindSpot(bs.id, "NOT_FOUND");
    await mod.createBreakdown({ project: "Glass Houses", castingDirector: "Lena Park", source: "Test" });
    await mod.rerunUnreviewed();
    const after = await mod.prisma.blindSpot.findUniqueOrThrow({ where: { id: bs.id } });
    expect(after.reviewStatus).toBe("CONFIRMED_NOT_FOUND");
  });

  it("web monitor: saves findings, de-duplicates, respects intervals, pauses on login walls, and adds opportunities on request", async () => {
    const wm = await import("@/lib/server/webmonitor");
    const { clearRobotsCache } = await import("@/lib/web/fetcher");
    clearRobotsCache();
    const feed = `<rss><channel>
      <item><title>Now casting: Lakefront drama (Chicago)</title><link>https://news.example.org/1</link><description>Casting SAG-AFTRA actors in Chicago. Deadline: 12/01/2026</description></item>
      <item><title>Casting call: LA commercial</title><link>https://news.example.org/2</link><description>Los Angeles, CA</description></item>
    </channel></rss>`;
    let body = feed;
    const deps = {
      lookup: async () => [{ address: "93.184.216.34" }],
      fetch: async (url: string) =>
        url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response(body, { status: 200, headers: { "content-type": "application/rss+xml" } }),
    };
    const src = await mod.prisma.webSource.create({
      data: { name: "Test feed", url: "https://news.example.org/feed", kind: "RSS", region: "CHICAGO", keywords: ["casting"], excludeKeywords: [], enabled: true, termsConfirmed: true },
    });
    const t0 = new Date("2026-09-29T12:00:00Z");
    const r1 = await wm.checkSource(src.id, { now: t0, deps });
    expect(r1.newFindings).toBe(1); // LA item filtered out for a Chicago source
    const finding = await mod.prisma.webFinding.findFirstOrThrow({ where: { sourceId: src.id } });
    expect(finding.region).toBe("CHICAGO");
    expect(finding.detectedDeadline?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(await mod.prisma.alert.count({ where: { dedupeKey: `WEB:${finding.id}` } })).toBe(1);

    // too soon: skipped without a request
    const r2 = await wm.checkSource(src.id, { now: new Date(t0.getTime() + 30 * 60_000), deps });
    expect(r2.skipped).toMatch(/waiting/);
    // later: same item not duplicated
    const r3 = await wm.checkSource(src.id, { now: new Date(t0.getTime() + 7 * 3_600_000), deps });
    expect(r3.newFindings).toBe(0);

    // accept -> UNVERIFIED public breakdown with source link
    const bId = await wm.acceptFinding(finding.id, { roleName: "Lead" });
    const b = await mod.prisma.publicBreakdown.findUniqueOrThrow({ where: { id: bId }, include: { project: true } });
    expect(b.verifiedAt).toBeNull();
    expect(b.sourceUrl).toBe("https://news.example.org/1");
    expect(b.source).toBe("Web monitor: Test feed");
    expect(b.roleName).toBe("Lead");

    // site starts requiring login -> source paused, not retried
    body = `<h1>Sign in</h1><input type="password">`;
    const r4 = await wm.checkSource(src.id, { now: new Date(t0.getTime() + 14 * 3_600_000), deps });
    expect(r4.ok).toBe(false);
    expect((await mod.prisma.webSource.findUniqueOrThrow({ where: { id: src.id } })).enabled).toBe(false);
    const r5 = await wm.checkSource(src.id, { now: new Date(t0.getTime() + 30 * 3_600_000), deps });
    expect(r5.skipped).toBe("Disabled");
  });

  it("web monitor: sources without terms confirmation or on blocked domains never run", async () => {
    const wm = await import("@/lib/server/webmonitor");
    let calls = 0;
    const deps = { lookup: async () => [{ address: "93.184.216.34" }], fetch: async () => { calls++; return new Response("", { status: 200 }); } };
    const a = await mod.prisma.webSource.create({ data: { name: "No terms", url: "https://x.example.org/a", kind: "HTML", keywords: [], excludeKeywords: [], enabled: true, termsConfirmed: false } });
    const b = await mod.prisma.webSource.create({ data: { name: "AA", url: "https://actorsaccess.com/x", kind: "HTML", keywords: [], excludeKeywords: [], enabled: true, termsConfirmed: true } });
    expect((await wm.checkSource(a.id, { deps })).skipped).toBe("Terms not confirmed");
    expect((await wm.checkSource(b.id, { deps })).skipped).toMatch(/never collects/);
    expect(calls).toBe(0);
  });
});
