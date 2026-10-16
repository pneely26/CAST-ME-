import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { assertLeadAccess, can } from "@/server/policy";
import { territoryOptions } from "@/server/services/territories";
import { repOptions } from "@/server/options";
import { PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { LeadFormFields } from "@/components/LeadForm";
import { Field, Fieldset, Select } from "@/components/fields";
import { updateLeadAction } from "@/app/actions/leads";
import { LEAD_STATUSES, LEAD_STATUS_LABEL } from "@/lib/labels";

export const metadata = { title: "Edit lead" };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) notFound();
  try {
    assertLeadAccess(actor, lead);
  } catch {
    notFound();
  }
  const isCoord = can(actor, "lead.editAll");
  const [territories, reps] = isCoord ? await Promise.all([territoryOptions(), repOptions()]) : [[], []];
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${lead.businessName}`} back={{ href: `/leads/${lead.id}`, label: lead.businessName }} subtitle={isCoord ? undefined : "As the sales rep you can update contact details and status. Ask the coordinator to change anything else."} />
      <ActionForm action={updateLeadAction}>
        <input type="hidden" name="id" value={lead.id} />
        <input type="hidden" name="version" value={lead.version} />
        {isCoord ? (
          <LeadFormFields lead={lead} territories={territories} reps={reps} />
        ) : (
          <Fieldset title="Contact & status">
            <Field label="Contact person" name="contactName" defaultValue={lead.contactName} />
            <Field label="Job title" name="jobTitle" defaultValue={lead.jobTitle} />
            <Field label="Phone" name="phone" type="tel" defaultValue={lead.phone} />
            <Field label="Email" name="email" type="email" defaultValue={lead.email} />
            <Select label="Status" name="status" defaultValue={lead.status} options={LEAD_STATUSES.map((s) => ({ value: s, label: LEAD_STATUS_LABEL[s] }))} />
          </Fieldset>
        )}
        <div className="mt-4"><SubmitButton>Save changes</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
