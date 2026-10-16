// Scheduled monitoring entry point. Example crontab (every 6 hours):
//   0 */6 * * * cd /path/to/app && npm run monitor >> monitor.log 2>&1
import "./load-env";
import { runMonitor } from "../src/lib/server/monitor";
import { prisma } from "../src/lib/server/db";

runMonitor()
  .then((log) => console.log(`[${new Date().toISOString()}] monitor:\n  ` + log.join("\n  ")))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
