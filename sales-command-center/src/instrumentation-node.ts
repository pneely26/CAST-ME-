import { bootstrapIfEmpty } from "./server/bootstrap";
import { maybeSendScheduledEmails } from "./server/services/scheduleEmail";

await bootstrapIfEmpty().catch((e) => console.error("[bootstrap] failed", e));

// the daily "tomorrow's schedule" email: checked every 5 minutes while the server is running
if (process.env.NODE_ENV === "production" && !process.env.DISABLE_SCHEDULER) {
  const tick = () =>
    maybeSendScheduledEmails()
      .then((r) => r && console.log(`[schedule-email] ${r.date}: ${r.results.filter((x) => x.status === "sent").length} sent`))
      .catch((e) => console.error("[schedule-email] failed", e));
  setInterval(tick, 5 * 60_000).unref();
}
