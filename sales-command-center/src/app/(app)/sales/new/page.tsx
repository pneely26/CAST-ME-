import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { leadScope } from "@/server/policy";
import { repOptions } from "@/server/options";
import { sp, type SP } from "@/server/services/leadQuery";
import { Flash, PageHeader } from "@/components/ui";
import { OpportunityForm } from "@/components/OpportunityForm";
import { dateKeyInTz } from "@/lib/time";

export const metadata = { title: "Record sale" };

export default async function NewOppPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  const tz = (await getSettings()).timezone;
  const leads = await prisma.lead.findMany({ where: { ...leadScope(actor), archivedAt: null }, select: { id: true, businessName: true, city: true, estimatedValue: true }, orderBy: { businessName: "asc" }, take: 3000 });
  const leadId = sp(params, "lead");
  const visitId = sp(params, "visit");
  const fromVisit = visitId ? await prisma.visit.findUnique({ where: { id: visitId }, select: { id: true, leadId: true, outcome: true } }) : null;
  const lead = leads.find((l) => l.id === leadId);
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: lead ? `/leads/${lead.id}?tab=sales` : "/sales", label: lead?.businessName ?? "Sales" }} title="Record sale" subtitle={lead ? lead.businessName : undefined} />
      <Flash message={sp(params, "msg")} />
      <OpportunityForm
        today={dateKeyInTz(new Date(), tz)}
        leads={leads.map((l) => ({ id: l.id, label: `${l.businessName}${l.city ? ` — ${l.city}` : ""}` }))}
        reps={actor.role === "COORDINATOR" ? await repOptions() : undefined}
        d={{ leadId: lead?.id, status: fromVisit?.outcome === "SALE_COMPLETED" ? "WON" : "PROSPECTING", sourceVisitId: fromVisit && fromVisit.leadId === leadId ? fromVisit.id : null, estimatedValue: lead?.estimatedValue ? String(lead.estimatedValue) : undefined }}
      />
    </div>
  );
}
