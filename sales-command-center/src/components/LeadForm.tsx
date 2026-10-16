import type { Lead } from "@prisma/client";
import { Field, Fieldset, Select, TextArea, Checkbox } from "./fields";
import { LEAD_STATUSES, LEAD_STATUS_LABEL, PRIORITIES, PRIORITY_LABEL } from "@/lib/labels";

type Territory = { id: string; name: string; areas: { id: string; name: string }[] };

export function LeadFormFields({ lead, territories, reps, isNew }: { lead?: Partial<Lead> | null; territories: Territory[]; reps: { id: string; name: string }[]; isNew?: boolean }) {
  return (
    <div className="space-y-4">
      <Fieldset title="Business">
        <Field label="Business / company name" name="businessName" required defaultValue={lead?.businessName} className="sm:col-span-2" />
        <Field label="Industry / category" name="industry" defaultValue={lead?.industry} />
        <Field label="Lead source" name="source" defaultValue={lead?.source} placeholder="Referral, walk-in, list…" />
      </Fieldset>
      <Fieldset title="Contact">
        <Field label="Contact person" name="contactName" defaultValue={lead?.contactName} autoComplete="off" />
        <Field label="Job title" name="jobTitle" defaultValue={lead?.jobTitle} />
        <Field label="Phone" name="phone" type="tel" inputMode="tel" defaultValue={lead?.phone} />
        <Field label="Email" name="email" type="email" defaultValue={lead?.email} />
      </Fieldset>
      <Fieldset title="Location" cols={3}>
        <Field label="Street address" name="address" defaultValue={lead?.address} className="sm:col-span-2 lg:col-span-3" />
        <Field label="City" name="city" defaultValue={lead?.city} />
        <Field label="State" name="state" defaultValue={lead?.state ?? (isNew ? "IL" : "")} />
        <Field label="ZIP" name="zip" inputMode="numeric" defaultValue={lead?.zip} />
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="label">Area / neighborhood</span>
          <select name="areaId" defaultValue={lead?.areaId ?? ""} className="input">
            <option value="">No area</option>
            {territories.map((t) => (
              <optgroup key={t.id} label={t.name}>
                {t.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <Select label="Territory / region" name="territoryId" defaultValue={lead?.territoryId} empty="Set by area (or none)" options={territories.map((t) => ({ value: t.id, label: t.name }))} hint="Picking an area sets its territory automatically." />
      </Fieldset>
      <Fieldset title="Pipeline" cols={3}>
        <Select label="Status" name="status" defaultValue={lead?.status ?? "NEW"} options={LEAD_STATUSES.map((s) => ({ value: s, label: LEAD_STATUS_LABEL[s] }))} />
        <Select label="Priority" name="priority" defaultValue={lead?.priority ?? "NORMAL"} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
        <Select label="Assigned sales rep" name="assignedRepId" defaultValue={lead?.assignedRepId} empty="Unassigned" options={reps.map((r) => ({ value: r.id, label: r.name }))} />
        <Field label="Estimated deal value ($)" name="estimatedValue" inputMode="decimal" defaultValue={lead?.estimatedValue ? String(lead.estimatedValue) : ""} />
        <Field label="Tags (comma-separated)" name="tags" defaultValue={lead?.tags?.join(", ")} className="lg:col-span-2" />
        <TextArea label="Coordinator notes" name="notes" defaultValue={lead?.notes} rows={4} className="sm:col-span-2 lg:col-span-3" hint="Saved exactly as written." />
      </Fieldset>
      {isNew && <Checkbox name="allowDuplicate" label="Create anyway, even if it looks like an existing lead" />}
    </div>
  );
}
