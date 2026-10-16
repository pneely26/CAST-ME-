import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { assertLeadAccess, isCoordinator } from "@/server/policy";
import { repOptions } from "@/server/options";
import { PageHeader } from "@/components/ui";
import { LeadStatusBadge } from "@/components/badges";
import { VisitForm } from "./VisitForm";
import { formatPhone } from "@/lib/normalize";
import { dateKeyInTz, timeInTz, fmtDate } from "@/lib/time";

export const metadata = { title: "Record visit" };

export default async function RecordVisitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string; appointment?: string; type?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireActor();
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead || lead.archivedAt) notFound();
  try {
    assertLeadAccess(actor, lead);
  } catch {
    notFound();
  }
  const tz = (await getSettings()).timezone;
  const now = new Date();
  const mapQuery = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
  const reps = isCoordinator(actor) ? await repOptions() : undefined;
  const returnTo = sp.returnTo && sp.returnTo.startsWith("/") && !sp.returnTo.startsWith("//") ? sp.returnTo : `/leads/${lead.id}?tab=visits`;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back={{ href: returnTo, label: returnTo.startsWith("/today") ? "Today's route" : lead.businessName }} title={`Visit: ${lead.businessName}`} subtitle={<span className="flex flex-wrap items-center gap-2"><LeadStatusBadge s={lead.status} />{lead.lastVisitAt ? `Last visited ${fmtDate(lead.lastVisitAt, tz)}` : "First visit"}</span>} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex">
        {lead.phone && <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="btn-secondary">📞 {formatPhone(lead.phone)}</a>}
        {mapQuery && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noopener noreferrer" className="btn-secondary truncate">⌖ {lead.address ?? mapQuery}</a>}
      </div>
      {lead.latestFeedback && <p className="mb-4 rounded-md bg-white px-3 py-2 text-sm text-ink-2 ring-1 ring-line"><span className="text-xs text-muted">Last feedback: </span>{lead.latestFeedback}</p>}
      <VisitForm
        leadId={lead.id}
        currentStatus={lead.status}
        today={dateKeyInTz(now, tz)}
        nowTime={timeInTz(now, tz)}
        returnTo={returnTo}
        appointmentId={sp.appointment ?? null}
        defaultType={sp.type === "PHONE_CALL" ? "PHONE_CALL" : sp.appointment ? "SCHEDULED_APPOINTMENT" : "WALK_IN"}
        reps={reps}
        defaultRepId={lead.assignedRepId}
        contactName={lead.contactName}
      />
    </div>
  );
}
