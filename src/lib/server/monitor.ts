import { prisma } from "./db";
import { scheduledAdapters } from "../adapters/registry";
import { generateAlerts } from "../alerts/engine";
import { rerunUnreviewed } from "./detection";
import { updateBreakdownRelevance } from "./profile";

/**
 * Scheduled monitoring pipeline. Safe to run from cron (npm run monitor) or /api/cron/monitor.
 * 1. Run enabled, compliant, automated source adapters (none by default).
 * 2. Refresh relevance, re-run blind-spot detection, emit alerts.
 */
export async function runMonitor(now = new Date()) {
  const log: string[] = [];
  for (const adapter of scheduledAdapters()) {
    const run = await prisma.sourceRun.create({ data: { adapterId: adapter.id } });
    try {
      const last = await prisma.sourceRun.findFirst({ where: { adapterId: adapter.id, ok: true }, orderBy: { startedAt: "desc" } });
      const min = adapter.compliance.minIntervalMinutes ?? 60;
      if (last && now.getTime() - last.startedAt.getTime() < min * 60_000) {
        await prisma.sourceRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: true, message: "Skipped: min interval" } });
        continue;
      }
      const ctx = { now };
      const raw = await adapter.fetch(ctx);
      const items = raw.map((r, i) => adapter.validate(adapter.normalize(r, i + 1, ctx)));
      const s = await adapter.save(items, ctx, {});
      await prisma.sourceRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: true, message: `saved ${s.saved}` } });
      log.push(`${adapter.id}: saved ${s.saved}`);
    } catch (e) {
      await prisma.sourceRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, message: (e as Error).message } });
      log.push(`${adapter.id}: failed`);
    }
  }
  // Past-deadline breakdowns are displayed as CASTING CLOSED via sourceState(); stored data is not rewritten.
  await updateBreakdownRelevance();
  const rerun = await rerunUnreviewed();
  log.push(`re-ran detection for ${rerun} submission(s)`);
  const alerts = await generateAlerts(now);
  log.push(`created ${alerts} alert(s)`);
  return log;
}
