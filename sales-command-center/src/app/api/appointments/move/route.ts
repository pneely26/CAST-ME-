import { getActor } from "@/server/auth";
import { moveAppointment } from "@/server/services/appointments";
import { toResult } from "@/server/errors";

/** Drag-and-drop move (coordinator). Returns { ok } or { ok:false, error, code } for the calendar. */
export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ ok: false, error: "Your session has ended." }, { status: 401 });
  try {
    const b = await req.json();
    await moveAppointment(actor, String(b.id), new Date(b.start), new Date(b.end), typeof b.reason === "string" && b.reason.trim() ? b.reason.trim().slice(0, 500) : "Moved on calendar", { allowOverlap: Boolean(b.allowOverlap), untimed: b.allDay === true });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(toResult(e));
  }
}
