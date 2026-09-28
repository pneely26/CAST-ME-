"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProjectStatus } from "@prisma/client";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { normalizedTitleString } from "@/lib/normalize";
import { ensureCastingDirectors, linkCasting } from "@/lib/server/records";
import { rerunUnreviewed } from "@/lib/server/detection";
import { updateBreakdownRelevance } from "@/lib/server/profile";
import { fid, fplatform, fregion, fstr, furl } from "@/lib/server/forms";
import { PROJECT_STATUSES } from "@/lib/constants";

function projectFields(fd: FormData) {
  const title = fstr(fd, "title", 300);
  const status = fstr(fd, "status", 40);
  return {
    title,
    normalizedTitle: normalizedTitleString(title),
    platform: fplatform(fd),
    productionType: fstr(fd, "productionType", 100),
    unionStatus: fstr(fd, "unionStatus", 100),
    region: fregion(fd),
    filmingLocation: fstr(fd, "filmingLocation", 200),
    genre: fstr(fd, "genre", 100),
    status: (status && (PROJECT_STATUSES as readonly string[]).includes(status) ? status : "UNKNOWN") as ProjectStatus,
    sourceName: fstr(fd, "sourceName", 200),
    sourceUrl: furl(fd, "sourceUrl"),
    notes: fstr(fd, "notes", 4000),
  };
}

export async function createProjectAction(fd: FormData) {
  await requireUser();
  const data = projectFields(fd);
  if (!data.title) redirect("/projects/new?error=Title+is+required");
  const p = await prisma.project.create({
    data: { ...data, title: data.title, verifiedAt: fd.get("verified") === "on" ? new Date() : null },
  });
  const cds = await ensureCastingDirectors(fstr(fd, "castingDirector", 300), { office: fstr(fd, "castingOffice", 200), sourceName: data.sourceName });
  await linkCasting(p.id, cds.map((c) => c.id), fstr(fd, "castingOffice", 200), "Casting Director");
  await audit("CREATE", "Project", p.id, `Added project: ${p.title}`);
  revalidatePath("/", "layout");
  redirect(`/projects/${p.id}?msg=Project+saved.+Add+a+breakdown+to+include+it+in+the+public+dataset.`);
}

export async function updateProjectAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  const data = projectFields(fd);
  if (!data.title) redirect(`/projects/${id}?error=Title+is+required`);
  await prisma.project.update({ where: { id }, data: { ...data, title: data.title, ...(fd.get("verified") === "on" ? { verifiedAt: new Date() } : {}) } });
  const cdRaw = fstr(fd, "castingDirector", 300);
  if (cdRaw) {
    const cds = await ensureCastingDirectors(cdRaw, { office: fstr(fd, "castingOffice", 200) });
    await linkCasting(id, cds.map((c) => c.id), fstr(fd, "castingOffice", 200), "Casting Director");
  }
  await audit("EDIT", "Project", id, `Edited project: ${data.title}`);
  await updateBreakdownRelevance((await prisma.publicBreakdown.findMany({ where: { projectId: id }, select: { id: true } })).map((b) => b.id));
  await rerunUnreviewed();
  revalidatePath("/", "layout");
  redirect(`/projects/${id}?msg=Saved`);
}

export async function removeCastingCreditAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  const c = await prisma.projectCasting.delete({ where: { id }, include: { castingDirector: true, project: true } });
  await audit("DELETE", "ProjectCasting", id, `Removed ${c.castingDirector.name} from ${c.project.title}`);
  revalidatePath(`/projects/${c.projectId}`);
}

/** Merge `sourceId` into `targetId`. Only with explicit confirmation. */
export async function mergeProjectsAction(fd: FormData) {
  await requireUser();
  const targetId = fid(fd, "targetId");
  const sourceId = fid(fd, "sourceId");
  if (fd.get("confirm") !== "yes") redirect(`/projects/${targetId}?error=Confirm+the+merge+first`);
  if (targetId === sourceId) redirect(`/projects/${targetId}`);
  const [target, source] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: targetId } }),
    prisma.project.findUniqueOrThrow({ where: { id: sourceId }, include: { castings: true } }),
  ]);
  await prisma.$transaction(async (tx) => {
    await tx.publicBreakdown.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } });
    await tx.agencySubmission.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } });
    await tx.blindSpot.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } });
    await tx.blindSpot.updateMany({ where: { candidateProjectId: sourceId }, data: { candidateProjectId: targetId } });
    for (const c of source.castings) {
      await tx.projectCasting.upsert({
        where: { projectId_castingDirectorId: { projectId: targetId, castingDirectorId: c.castingDirectorId } },
        update: {},
        create: { projectId: targetId, castingDirectorId: c.castingDirectorId, role: c.role, castingOffice: c.castingOffice },
      });
    }
    await tx.watchlistItem.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } });
    const hasBreakdowns = (await tx.publicBreakdown.count({ where: { projectId: targetId } })) > 0;
    await tx.project.update({
      where: { id: targetId },
      data: {
        agencyReported: target.agencyReported && !hasBreakdowns,
        notes: [target.notes, `Merged with “${source.title}” on ${new Date().toISOString().slice(0, 10)}.`].filter(Boolean).join("\n"),
      },
    });
    await tx.project.delete({ where: { id: sourceId } });
  });
  await audit("EDIT", "Project", targetId, `Merged “${source.title}” into “${target.title}” (confirmed by user)`, { sourceId });
  revalidatePath("/", "layout");
  redirect(`/projects/${targetId}?msg=Projects+merged`);
}

export async function deleteProjectAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  if (fd.get("confirm") !== "yes") redirect(`/projects/${id}?error=Tick+the+confirmation+box+to+delete`);
  const p = await prisma.project.delete({ where: { id } });
  await audit("DELETE", "Project", id, `Deleted project: ${p.title} (with its breakdowns and blind-spot records)`);
  revalidatePath("/", "layout");
  redirect("/projects");
}
