import { Field, TextArea, RegionSelect, VisibilitySelect, FormSection } from "./FormFields";

type D = Record<string, string | null | undefined>;

export function BreakdownRoleFields({ d = {} }: { d?: D }) {
  return (
    <>
      <FormSection title="Role (as stated in the breakdown)" note="Enter only what the breakdown explicitly says. Leave blank when not stated — nothing is inferred.">
        <Field label="Role name" name="roleName" defaultValue={d.roleName} />
        <Field label="Role type" name="roleType" defaultValue={d.roleType} placeholder="Series Regular, Recurring, Guest Star, Co-Star…" />
        <Field label="Age range" name="ageRange" defaultValue={d.ageRange} placeholder="25-35, 20s-30s…" />
        <Field label="Gender" name="gender" defaultValue={d.gender} placeholder="As stated, or blank" />
        <Field label="Ethnicity (only if explicitly stated)" name="ethnicity" defaultValue={d.ethnicity} placeholder="Blank if not stated" />
        <Field label="Union" name="unionStatus" defaultValue={d.unionStatus} placeholder="SAG-AFTRA, AEA, Non-Union…" />
        <TextArea label="Character description" name="characterDescription" defaultValue={d.characterDescription} className="sm:col-span-2" />
      </FormSection>
      <FormSection title="Casting & dates">
        <Field label="Casting director(s)" name="castingDirector" defaultValue={d.castingDirector} placeholder="Jane Doe & John Roe" />
        <Field label="Casting office" name="castingOffice" defaultValue={d.castingOffice} />
        <RegionSelect label="Breakdown region" defaultValue={d.region} />
        <VisibilitySelect defaultValue={d.visibility} />
        <Field label="Posted date" name="postedDate" type="date" defaultValue={d.postedDate} />
        <Field label="Submission deadline" name="submissionDeadline" type="date" defaultValue={d.submissionDeadline} />
      </FormSection>
      <FormSection title="Source" note="Where you found this. Only public or user-provided sources.">
        <Field label="Source name" name="source" required defaultValue={d.source} placeholder="e.g. Actors Access (public listing), production website" />
        <Field label="Source URL" name="sourceUrl" type="url" defaultValue={d.sourceUrl} placeholder="https://…" />
      </FormSection>
    </>
  );
}
