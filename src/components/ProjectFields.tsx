import { Field, TextArea, RegionSelect, PlatformSelect, ProductionTypeSelect, FormSection } from "./FormFields";
import { PROJECT_STATUSES, humanize } from "@/lib/constants";

type D = Record<string, string | null | undefined>;

export function ProjectFields({ d = {}, platforms, cdHint }: { d?: D; platforms: string[]; cdHint?: string }) {
  return (
    <>
      <FormSection title="Project">
        <Field label="Title" name="title" required defaultValue={d.title} />
        <ProductionTypeSelect defaultValue={d.productionType} />
        <div className="sm:col-span-2"><PlatformSelect platforms={platforms} defaultValue={d.platform} /></div>
        <RegionSelect label="Project region" defaultValue={d.region} />
        <Field label="Filming location" name="filmingLocation" defaultValue={d.filmingLocation} />
        <Field label="Union status" name="unionStatus" defaultValue={d.unionStatus} />
        <Field label="Genre" name="genre" defaultValue={d.genre} />
        <label className="block">
          <span className="label">Status</span>
          <select name="status" defaultValue={d.status ?? "UNKNOWN"} className="input">
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
        </label>
      </FormSection>
      <FormSection title="Casting" note={cdHint}>
        <Field label="Add casting director(s)" name="castingDirector" placeholder="Jane Doe & John Roe" />
        <Field label="Casting office" name="castingOffice" />
      </FormSection>
      <FormSection title="Source">
        <Field label="Source name" name="sourceName" defaultValue={d.sourceName} />
        <Field label="Source URL" name="sourceUrl" type="url" defaultValue={d.sourceUrl} />
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="verified" /> I verified this at the source today</label>
        <TextArea label="Notes" name="notes" defaultValue={d.notes} className="sm:col-span-2" />
      </FormSection>
    </>
  );
}
