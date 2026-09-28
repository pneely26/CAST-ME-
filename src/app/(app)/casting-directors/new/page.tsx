import { createCastingDirectorAction } from "@/app/actions/castingDirectors";
import { Flash, PageHeader } from "@/components/ui";
import { CastingDirectorFields } from "@/components/CastingDirectorFields";

export const metadata = { title: "New casting director" };

export default async function NewCDPage({ searchParams }: { searchParams: Promise<{ error?: string; name?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="max-w-3xl">
      <PageHeader title="New casting director" />
      <Flash message={sp.error} tone="bad" />
      <form action={createCastingDirectorAction} className="space-y-4">
        <CastingDirectorFields d={{ name: sp.name }} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="watch" defaultChecked /> Add to watchlist</label>
        <button className="btn-primary">Save casting director</button>
      </form>
    </div>
  );
}
