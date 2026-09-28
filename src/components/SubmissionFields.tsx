import { Field, TextArea, RegionSelect, PlatformSelect, FormSection } from "./FormFields";

type D = Record<string, string | null | undefined>;

export function SubmissionFields({ d = {}, platforms }: { d?: D; platforms: string[] }) {
  return (
    <>
      <FormSection title="Submission (as reported by your agency)" note="Private agency information. Stored only in your database; never published.">
        <Field label="Project (as reported)" name="projectTitleRaw" required defaultValue={d.projectTitleRaw} />
        <Field label="Date submitted" name="dateSubmitted" type="date" defaultValue={d.dateSubmitted} />
        <Field label="Role" name="role" defaultValue={d.role} />
        <Field label="Casting director" name="castingDirectorRaw" defaultValue={d.castingDirectorRaw} />
        <div className="sm:col-span-2"><PlatformSelect platforms={platforms} defaultValue={d.platform} /></div>
        <RegionSelect defaultValue={d.region} />
        <Field label="Union" name="unionStatus" defaultValue={d.unionStatus} />
        <Field label="Status" name="status" defaultValue={d.status} placeholder="Submitted, Self-tape requested, Callback…" />
        <Field label="Source" name="source" defaultValue={d.source ?? "Agency report (manual)"} />
        <TextArea label="Notes" name="notes" defaultValue={d.notes} className="sm:col-span-2" />
      </FormSection>
    </>
  );
}
