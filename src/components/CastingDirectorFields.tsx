import { Field, TextArea, FormSection } from "./FormFields";

type D = Record<string, string | null | undefined>;

export function CastingDirectorFields({ d = {} }: { d?: D }) {
  return (
    <>
      <FormSection title="Casting director" note="Location is where the casting director/office is based. It is tracked separately from project/breakdown regions.">
        <Field label="Name" name="name" required defaultValue={d.name} />
        <Field label="Casting office" name="castingOffice" defaultValue={d.castingOffice} />
        <Field label="Based in — city" name="city" defaultValue={d.city} />
        <Field label="Based in — state" name="state" defaultValue={d.state} />
        <Field label="Website" name="website" type="url" defaultValue={d.website} />
      </FormSection>
      <FormSection title="Source">
        <Field label="Source name" name="sourceName" defaultValue={d.sourceName} placeholder="e.g. CSA directory, office website" />
        <Field label="Source URL" name="sourceUrl" type="url" defaultValue={d.sourceUrl} />
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="verified" /> I verified these details at the source today</label>
        <TextArea label="Notes" name="notes" defaultValue={d.notes} className="sm:col-span-2" />
      </FormSection>
    </>
  );
}
