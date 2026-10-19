import type { Lead } from "@prisma/client";
import { Field, Select, TextArea, Checkbox } from "./fields";

type LeadDefaults = Partial<Lead>;

/**
 * Lead form laid out like the BC Desk "Quick Appointment" screen: contact details on the left,
 * BC notes, business details, appointment date and BC info on the right.
 * Area and territory are set from the city and state automatically.
 */
export function LeadFormFields({ lead, reps, isNew, defaults }: { lead?: LeadDefaults | null; reps: { id: string; name: string }[]; isNew?: boolean; defaults?: LeadDefaults }) {
  const v = <K extends keyof Lead>(k: K) => (lead?.[k] ?? defaults?.[k] ?? null) as Lead[K] | null;
  const num = (n: number | null | undefined) => (n != null ? String(n) : "");
  return (
    <div className="space-y-4">
      <div className="card grid gap-x-6 gap-y-3 p-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Control Number" name="externalId" defaultValue={v("externalId")} hint="The prospect # (PN). Used to match imports and sales reports." />
          <Select label="Sales Rep" name="assignedRepId" defaultValue={v("assignedRepId")} empty="Unassigned" options={reps.map((r) => ({ value: r.id, label: r.name }))} />
          <Field label="Prospect Name" name="contactName" defaultValue={v("contactName")} autoComplete="off" />
          <Field label="Prospect Title" name="jobTitle" defaultValue={v("jobTitle")} />
          <Field label="Company Name" name="businessName" required defaultValue={v("businessName")} />
          <Field label="Address 1" name="address" defaultValue={v("address")} />
          <Field label="Address 2" name="address2" defaultValue={v("address2")} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Zip/Postal Code" name="zip" inputMode="numeric" defaultValue={v("zip")} />
            <Field label="City" name="city" defaultValue={v("city")} />
            <Field label="State" name="state" defaultValue={v("state")} />
          </div>
          <Field label="Country" name="country" defaultValue={v("country") ?? "USA"} />
          <Field label="Telephone" name="phone" type="tel" inputMode="tel" defaultValue={v("phone")} />
          <Field label="Cell Phone" name="cellPhone" type="tel" inputMode="tel" defaultValue={v("cellPhone")} />
          <Field label="Email" name="email" type="email" defaultValue={v("email")} />
        </div>
        <div className="space-y-3">
          <TextArea label="BC Notes" name="notes" defaultValue={v("notes")} rows={5} hint="Saved exactly as written." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Number of Employees" name="employeeCount" inputMode="numeric" defaultValue={num(v("employeeCount"))} />
            <Field label="Business Volume ($ millions)" name="businessVolume" inputMode="decimal" defaultValue={v("businessVolume")} placeholder="e.g. 1.50" />
          </div>
          <Field label="Type of Business" name="industry" defaultValue={v("industry")} placeholder="e.g. Construction Company" />
          <TextArea label="Problems" name="problems" defaultValue={v("problems")} rows={2} />
          <Field label="Years in Business" name="yearsInBusiness" inputMode="numeric" defaultValue={num(v("yearsInBusiness"))} />
          {isNew && (
            <fieldset className="rounded-md border border-line p-3">
              <legend className="px-1 text-xs font-medium text-ink-2">Appointment (optional)</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date" name="apptDate" type="date" />
                <Field label="Time" name="apptTime" type="time" hint="Leave blank if there's no set time." />
                <div className="sm:col-span-2"><Checkbox name="apptConfirmed" label="Confirmed" /></div>
                <Field label="Confirmed By" name="apptConfirmedBy" className="sm:col-span-2" />
              </div>
              <p className="mt-2 text-xs text-muted">With a date, the appointment is booked with the sales rep above.</p>
            </fieldset>
          )}
          <Field label="BC" name="bcName" defaultValue={v("bcName")} />
          <Field label="BC Number" name="bcNumber" defaultValue={v("bcNumber")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="BC Co-Director 1" name="bcCoDirector1" defaultValue={v("bcCoDirector1")} />
            <Field label="BC Co-Director 2" name="bcCoDirector2" defaultValue={v("bcCoDirector2")} />
          </div>
        </div>
      </div>
      {isNew && <Checkbox name="allowDuplicate" label="Create anyway, even if it looks like an existing lead" />}
    </div>
  );
}
