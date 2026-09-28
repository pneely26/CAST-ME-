"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { runDetection } from "@/lib/server/detection";
import { generateAlerts } from "@/lib/alerts/engine";
import { normalizedTitleString } from "@/lib/normalize";
import { fdate, fid, fplatform, fregion, fstr } from "@/lib/server/forms";

function fields(fd: FormData) {
  const projectTitleRaw = fstr(fd, "projectTitleRaw", 300);
  return {
    projectTitleRaw,
    normalizedTitle: normalizedTitleString(projectTitleRaw),
    role: fstr(fd, "role", 200),
    castingDirectorRaw: fstr(fd, "castingDirectorRaw", 300),
    dateSubmitted: fdate(fd, "dateSubmitted"),
    platform: fplatform(fd),
    region: fregion(fd),
    unionStatus: fstr(fd, "unionStatus", 100),
    status: fstr(fd, "status", 100),
    notes: fstr(fd, "notes", 4000),
  };
}

export async function createSubmissionAction(fd: FormData) {
  await requireUser();
  const data = fields(fd);
  if (!data.projectTitleRaw) redirect("/submissions/new?error=Project+is+required");
  const s = await prisma.agencySubmission.create({ data: { ...data, projectTitleRaw: data.projectTitleRaw, source: fstr(fd, "source", 200) ?? "Agency report (manual)" } });
  await audit("CREATE", "AgencySubmission", s.id, `Added agency submission: ${s.projectTitleRaw}${s.role ? ` — ${s.role}` : ""}`);
  const bs = await runDetection(s.id);
  await generateAlerts();
  revalidatePath("/", "layout");
  redirect(`/blind-spots/${bs.id}?msg=Submission+saved+and+checked+against+the+public+dataset`);
}

export async function updateSubmissionAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  const data = fields(fd);
  if (!data.projectTitleRaw) redirect(`/submissions/${id}?error=Project+is+required`);
  await prisma.agencySubmission.update({ where: { id }, data: { ...data, projectTitleRaw: data.projectTitleRaw } });
  await audit("EDIT", "AgencySubmission", id, `Edited agency submission: ${data.projectTitleRaw}`);
  await runDetection(id);
  revalidatePath("/", "layout");
  redirect(`/submissions?msg=Saved`);
}

export async function deleteSubmissionAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  if (fd.get("confirm") !== "yes") redirect(`/submissions/${id}?error=Tick+the+confirmation+box+to+delete`);
  const s = await prisma.agencySubmission.delete({ where: { id } });
  // remove orphan agency-only project
  if (s.projectId) {
    const p = await prisma.project.findUnique({ where: { id: s.projectId }, include: { _count: { select: { submissions: true, breakdowns: true } } } });
    if (p?.agencyReported && p._count.submissions === 0 && p._count.breakdowns === 0) await prisma.project.delete({ where: { id: p.id } });
  }
  await audit("DELETE", "AgencySubmission", id, `Deleted agency submission: ${s.projectTitleRaw}`);
  revalidatePath("/", "layout");
  redirect("/submissions?msg=Deleted");
}
