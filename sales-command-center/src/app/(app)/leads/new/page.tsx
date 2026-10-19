import { requireActor } from "@/server/auth";
import { assertCan } from "@/server/policy";
import { prisma } from "@/server/db";
import { repOptions } from "@/server/options";
import { PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { LeadFormFields } from "@/components/LeadForm";
import { createLeadAction } from "@/app/actions/leads";
import { redirect } from "next/navigation";
import { can } from "@/server/policy";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const actor = await requireActor();
  if (!can(actor, "lead.create")) redirect("/leads");
  assertCan(actor, "lead.create");
  const [reps, last] = await Promise.all([
    repOptions(),
    // BC details usually stay the same from one lead to the next, so start from the last lead entered
    prisma.lead.findFirst({ where: { bcName: { not: null }, isDemo: false }, orderBy: { createdAt: "desc" }, select: { bcName: true, bcNumber: true, bcCoDirector1: true, bcCoDirector2: true, state: true, country: true } }),
  ]);
  const defaults = last ?? { bcName: actor.name };
  return (
    <div className="max-w-6xl">
      <PageHeader title="New lead" back={{ href: "/leads", label: "Leads" }} />
      <ActionForm action={createLeadAction}>
        <LeadFormFields reps={reps} defaults={defaults} isNew />
        <div className="mt-4 flex gap-2"><SubmitButton>Create lead</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
