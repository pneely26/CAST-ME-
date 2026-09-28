import { prisma } from "@/lib/server/db";
import { getPlatforms } from "@/lib/server/profile";
import { createBreakdownAction } from "@/app/actions/opportunities";
import { Flash, PageHeader } from "@/components/ui";
import { Field, PlatformSelect, ProductionTypeSelect, FormSection } from "@/components/FormFields";
import { BreakdownRoleFields } from "@/components/BreakdownRoleFields";
import { RegionSelect } from "@/components/FormFields";

export const metadata = { title: "New breakdown" };

export default async function NewBreakdownPage({ searchParams }: { searchParams: Promise<{ error?: string; projectId?: string }> }) {
  const sp = await searchParams;
  const [platforms, projects] = await Promise.all([
    getPlatforms(),
    prisma.project.findMany({ select: { id: true, title: true, platform: true }, orderBy: { title: "asc" } }),
  ]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="New public breakdown" description="Manually record a public casting listing." />
      <Flash message={sp.error} tone="bad" />
      <form action={createBreakdownAction} className="space-y-4">
        <FormSection title="Project">
          <label className="block sm:col-span-2">
            <span className="label">Attach to existing project (optional)</span>
            <select name="projectId" defaultValue={sp.projectId ?? ""} className="input">
              <option value="">— Create a new project —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}{p.platform ? ` (${p.platform})` : ""}</option>)}
            </select>
          </label>
          <Field label="Project title" name="project" placeholder="Required when creating a new project" />
          <ProductionTypeSelect />
          <div className="sm:col-span-2"><PlatformSelect platforms={platforms} /></div>
          <RegionSelect label="Project region" />
        </FormSection>
        <BreakdownRoleFields d={{ visibility: "PUBLIC" }} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="verified" /> I verified this listing at the source today</label>
        <button className="btn-primary">Save breakdown</button>
      </form>
    </div>
  );
}
