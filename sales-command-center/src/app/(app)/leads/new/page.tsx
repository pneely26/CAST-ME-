import { requireActor } from "@/server/auth";
import { assertCan } from "@/server/policy";
import { territoryOptions } from "@/server/services/territories";
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
  const [territories, reps] = await Promise.all([territoryOptions(), repOptions()]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="New lead" back={{ href: "/leads", label: "Leads" }} />
      <ActionForm action={createLeadAction}>
        <LeadFormFields territories={territories} reps={reps} isNew />
        <div className="mt-4 flex gap-2"><SubmitButton>Create lead</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
