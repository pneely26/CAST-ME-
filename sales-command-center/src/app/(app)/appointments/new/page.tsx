import { randomUUID } from "node:crypto";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { leadScope, can, VIEW_ONLY_MESSAGE } from "@/server/policy";
import { repOptions } from "@/server/options";
import { sp, type SP } from "@/server/services/leadQuery";
import { PageHeader, Empty } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { createAppointmentAction } from "@/app/actions/appointments";
import { addDays, dateKeyInTz, isDateKey, timeInTz } from "@/lib/time";

export const metadata = { title: "New appointment" };

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  if (!can(actor, "data.write")) return <div className="card"><Empty>{VIEW_ONLY_MESSAGE}</Empty></div>;
  const settings = await getSettings();
  const tz = settings.timezone;
  const leads = await prisma.lead.findMany({ where: { ...leadScope(actor), archivedAt: null, status: { not: "DO_NOT_CONTACT" } }, select: { id: true, businessName: true, city: true, assignedRep: { select: { name: true } } }, orderBy: { businessName: "asc" }, take: 2000 });
  const reps = actor.role === "COORDINATOR" ? await repOptions() : [];
  const start = sp(params, "start") ? new Date(sp(params, "start")!) : null;
  const end = sp(params, "end") ? new Date(sp(params, "end")!) : null;
  const validStart = start && !isNaN(start.getTime()) ? start : null;
  const date = validStart ? dateKeyInTz(validStart, tz) : isDateKey(sp(params, "date")) ? sp(params, "date")! : addDays(dateKeyInTz(new Date(), tz), 1);
  const time = validStart ? timeInTz(validStart, tz) : "10:00";
  const minutes = validStart && end && !isNaN(end.getTime()) ? Math.round((end.getTime() - validStart.getTime()) / 60000) : settings.defaultAppointmentMinutes;
  return (
    <div className="max-w-2xl">
      <PageHeader back={{ href: "/appointments", label: "Appointments" }} title="New appointment" subtitle={`Times are ${tz.replace("_", " ")}.`} />
      <ActionForm action={createAppointmentAction} className="card grid gap-3 p-4 sm:grid-cols-2">
        <input type="hidden" name="clientKey" value={randomUUID()} />
        <label className="block sm:col-span-2"><span className="label">Business <span className="text-red-600">*</span></span>
          <select name="leadId" required defaultValue={sp(params, "lead") ?? ""} className="input">
            <option value="" disabled>Choose a lead…</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.businessName}{l.city ? ` — ${l.city}` : ""}{actor.role === "COORDINATOR" && l.assignedRep ? ` (${l.assignedRep.name})` : ""}</option>)}
          </select>
        </label>
        {actor.role === "COORDINATOR" && (
          <label className="block sm:col-span-2"><span className="label">Rep</span>
            <select name="repId" defaultValue={sp(params, "rep") ?? ""} className="input"><option value="">The lead's assigned rep</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
        )}
        <label className="block"><span className="label">Date <span className="text-red-600">*</span></span><input type="date" name="date" required defaultValue={date} className="input" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="label">Time <span className="text-red-600">*</span></span><input type="time" name="time" required defaultValue={time} className="input" /></label>
          <label className="block"><span className="label">Length (min)</span><input type="number" name="minutes" min={5} max={720} step={5} defaultValue={minutes} className="input" /></label>
        </div>
        <label className="block"><span className="label">Type</span>
          <select name="kind" className="input"><option value="APPOINTMENT">Confirmed appointment</option><option value="FOLLOW_UP_VISIT">Follow-up visit</option></select>
        </label>
        <label className="block"><span className="label">Location</span><input name="location" className="input" placeholder="Defaults to the lead's address" /></label>
        <label className="block sm:col-span-2"><span className="label">Notes</span><textarea name="notes" rows={3} className="input" /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="allowOverlap" /> Book anyway if it overlaps another appointment</label>
        <div className="sm:col-span-2"><SubmitButton>Book appointment</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
