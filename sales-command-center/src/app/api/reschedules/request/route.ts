import { getActor } from "@/server/auth";
import { requestReschedule } from "@/server/services/reschedules";
import { toResult } from "@/server/errors";

/** Rep drag-and-drop: becomes a reschedule request; the appointment does not move until approved. */
export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ ok: false, error: "Your session has ended." }, { status: 401 });
  try {
    const b = await req.json();
    await requestReschedule(actor, { appointmentId: String(b.id), requestedStart: new Date(b.start), requestedEnd: new Date(b.end), reason: String(b.reason ?? "") });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(toResult(e));
  }
}
