import { createSubmissionAction } from "@/app/actions/submissions";
import { getPlatforms } from "@/lib/server/profile";
import { Flash, PageHeader } from "@/components/ui";
import { SubmissionFields } from "@/components/SubmissionFields";

export const metadata = { title: "New agency submission" };

export default async function NewSubmissionPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const platforms = await getPlatforms();
  return (
    <div className="max-w-3xl">
      <PageHeader title="New agency submission" description="Record a submission your agency told you about. It is automatically compared with the public dataset." />
      <Flash message={sp.error} tone="bad" />
      <form action={createSubmissionAction} className="space-y-4">
        <SubmissionFields platforms={platforms} />
        <button className="btn-primary">Save & check public dataset</button>
      </form>
    </div>
  );
}
