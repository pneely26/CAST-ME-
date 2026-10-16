import { timingSafeEqual } from "node:crypto";
import { runReminders } from "@/server/services/reminders";

export const dynamic = "force-dynamic";

/**
 * Scheduler hook: POST (or GET, for schedulers that only GET) with `Authorization: Bearer $CRON_SECRET`.
 * Disabled unless CRON_SECRET is set.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return Response.json({ error: "Cron endpoint is disabled (set CRON_SECRET, 16+ characters)." }, { status: 404 });
  const got = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ ok: true, ...(await runReminders()) });
}

export const GET = handle;
export const POST = handle;
