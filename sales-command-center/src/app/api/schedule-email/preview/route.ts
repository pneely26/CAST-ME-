import { getActor } from "@/server/auth";
import { can } from "@/server/policy";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { renderScheduleEmail, repSchedule } from "@/server/services/scheduleEmail";
import { isDateKey } from "@/lib/time";

export const dynamic = "force-dynamic";

/** The schedule email exactly as the rep would get it (coordinator only). */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor || !can(actor, "settings.manage")) return new Response("Not allowed", { status: 403 });
  const u = new URL(req.url);
  const date = u.searchParams.get("date") ?? "";
  const rep = await prisma.user.findFirst({ where: { id: u.searchParams.get("rep") ?? "", role: "REP" } });
  if (!rep || !isDateKey(date)) return new Response("Choose a rep and a date", { status: 400 });
  const msg = renderScheduleEmail(rep.name, date, await repSchedule(rep.id, date), (await getSettings()).businessName);
  const banner = `<div style="font-family:sans-serif;background:#fef3c7;padding:8px 12px;font-size:13px">Preview — To: ${rep.email.replace(/</g, "&lt;")} · Subject: ${msg.subject.replace(/</g, "&lt;")}</div>`;
  return new Response(msg.html.replace(/(<body[^>]*>)/, `$1${banner}`), { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:", "x-frame-options": "DENY" } });
}
