import { createProjectAction } from "@/app/actions/projects";
import { getPlatforms } from "@/lib/server/profile";
import { Flash, PageHeader } from "@/components/ui";
import { ProjectFields } from "@/components/ProjectFields";

export const metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const platforms = await getPlatforms();
  return (
    <div className="max-w-3xl">
      <PageHeader title="New project" description="Create a project record. Add public breakdowns to it afterwards." />
      <Flash message={sp.error} tone="bad" />
      <form action={createProjectAction} className="space-y-4">
        <ProjectFields platforms={platforms} />
        <button className="btn-primary">Save project</button>
      </form>
    </div>
  );
}
