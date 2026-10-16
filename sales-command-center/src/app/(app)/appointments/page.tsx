import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { listAppointments } from "@/server/services/appointmentQuery";
import { sp, type SP } from "@/server/services/leadQuery";
import { repOptions } from "@/server/options";
import { Badge, Empty, Flash, PageHeader } from "@/components/ui";
import { ApptStatusBadge } from "@/components/badges";
import { fmtDateKey, fmtTime, dateKeyInTz, apptTimeRange } from "@/lib/time";

export const metadata = { title: "Appointments" };

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  const tz = (await getSettings()).timezone;
  const status = sp(params, "status") ?? "upcoming";
  const [rows, reps] = await Promise.all([listAppointments(actor, params), actor.role === "COORDINATOR" ? repOptions() : Promise.resolve([])]);
  const tabs: [string, string][] = [["upcoming", "Upcoming"], ["past", "Past"], ["completed", "Completed"], ["changed", "Rescheduled / canceled"], ["canceled", "Canceled"], ["all", "All"]];
  const qs = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" && v && k !== "msg" ? [[k, v]] : []))).toString();
  let lastDay = "";
  return (
    <div className="space-y-4">
      <PageHeader title="Appointments" subtitle="Canceled and rescheduled appointments stay in the history." actions={<><a href={`/api/export/appointments?${qs}`} className="btn-secondary">Export CSV</a><Link href="/appointments/new" className="btn-primary">New appointment</Link></>} />
      <Flash message={sp(params, "msg")} />
      <div className="flex flex-wrap items-center gap-1.5">
        {tabs.map(([k, l]) => <Link key={k} href={`/appointments?status=${k}${sp(params, "rep") ? `&rep=${sp(params, "rep")}` : ""}`} className={status === k ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{l}</Link>)}
        <form method="get" className="ml-auto flex gap-1">
          <input type="hidden" name="status" value={status} />
          <input name="q" defaultValue={sp(params, "q")} placeholder="Business" className="input py-1" aria-label="Search business" />
          {actor.role === "COORDINATOR" && <select name="rep" defaultValue={sp(params, "rep") ?? ""} className="input py-1" aria-label="Rep"><option value="">All reps</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
          <button className="btn-secondary btn-sm">Filter</button>
        </form>
      </div>
      {rows.length === 0 ? <div className="card"><Empty>No appointments here.</Empty></div> : (
        <div className="card divide-y divide-line-2">
          {rows.map((a) => {
            const day = dateKeyInTz(a.startAt, tz);
            const header = day !== lastDay ? (lastDay = day) : null;
            return (
              <div key={a.id}>
                {header && <div className="bg-canvas px-4 py-1.5 text-xs font-semibold text-ink-2">{fmtDateKey(day, { weekday: "long", month: "long", day: "numeric" })}</div>}
                <Link href={`/appointments/${a.id}`} className="flex flex-col gap-1 px-4 py-2.5 hover:bg-canvas sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium">{apptTimeRange(a, tz)} · {a.lead.businessName}</div>
                    <div className="truncate text-xs text-muted">{[a.kind === "FOLLOW_UP_VISIT" ? "Follow-up visit" : "Appointment", a.lead.area?.name, a.location ?? a.lead.address, actor.role === "COORDINATOR" ? a.rep.name : null].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <ApptStatusBadge s={a.status} />
                    {a.changes.length > 0 && <Badge tone="warn">Rescheduled {a.changes.length}×</Badge>}
                    {a.reschedules.length > 0 && <Badge tone="warn">Change requested</Badge>}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
