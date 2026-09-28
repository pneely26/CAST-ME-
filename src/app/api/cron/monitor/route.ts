import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runMonitor } from "@/lib/server/monitor";

export const dynamic = "force-dynamic";

/** POST /api/cron/monitor with header `Authorization: Bearer $CRON_SECRET`. Disabled unless CRON_SECRET is set. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return NextResponse.json({ error: "Not configured" }, { status: 404 });
  const got = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const log = await runMonitor();
  return NextResponse.json({ ok: true, log });
}
