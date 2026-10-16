/**
 * Generate due/overdue follow-up, upcoming appointment, and not-visited reminders (in-app only).
 *   npm run reminders
 * Safe to run on any schedule — each reminder is created once. Typical cron: every 15 minutes.
 */
import "./load-env";
import { runReminders } from "../src/server/services/reminders";
import { prisma } from "../src/server/db";

runReminders()
  .then((r) => {
    console.log(`Reminders checked — ${r.created} new notification(s). Follow-ups due today: ${r.followUpsDue}, overdue: ${r.followUpsOverdue}, appointments upcoming: ${r.appointmentsUpcoming}, not-visited digests: ${r.staleDigests}.`);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
