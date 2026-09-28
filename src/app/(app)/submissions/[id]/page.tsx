import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { deleteSubmissionAction, updateSubmissionAction } from "@/app/actions/submissions";
import { getPlatforms } from "@/lib/server/profile";
import { Flash, PageHeader } from "@/components/ui";
import { SubmissionFields } from "@/components/SubmissionFields";
import { isoDay } from "@/lib/format";

export default async function EditSubmissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await prisma.agencySubmission.findUnique({ where: { id } });
  if (!s) notFound();
  const platforms = await getPlatforms();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Edit agency submission" />
      <Flash message={sp.error} tone="bad" />
      <form action={updateSubmissionAction} className="space-y-4">
        <input type="hidden" name="id" value={s.id} />
        <SubmissionFields platforms={platforms} d={{ projectTitleRaw: s.projectTitleRaw, role: s.role, castingDirectorRaw: s.castingDirectorRaw, platform: s.platform, unionStatus: s.unionStatus, status: s.status, source: s.source, notes: s.notes, dateSubmitted: isoDay(s.dateSubmitted), region: s.region }} />
        <button className="btn-primary">Save & re-check</button>
      </form>
      <form action={deleteSubmissionAction} className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <input type="hidden" name="id" value={s.id} />
        <label className="flex items-center gap-2"><input type="checkbox" name="confirm" value="yes" /> Permanently delete this submission</label>
        <button className="btn-danger">Delete</button>
      </form>
    </div>
  );
}
