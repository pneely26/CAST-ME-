"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Visibility } from "@prisma/client";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { createBreakdown } from "@/lib/server/records";
import { updateBreakdownRelevance } from "@/lib/server/profile";
import { rerunUnreviewed } from "@/lib/server/detection";
import { generateAlerts } from "@/lib/alerts/engine";
import { fdate, fid, fplatform, fregion, fstr, furl } from "@/lib/server/forms";

function visibility(v: string | null): Visibility {
  return v === "PUBLIC" || v === "CLOSED" ? v : "UNKNOWN";
}

export async function createBreakdownAction(fd: FormData) {
  await requireUser();
  const projectId = fstr(fd, "projectId", 64);
  const existing = projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : null;
  const project = existing?.title ?? fstr(fd, "project", 300);
  const source = fstr(fd, "source", 200);
  if (!project || !source) redirect("/opportunities/new?error=Project+title+(or+an+existing+project)+and+source+are+required");
  const b = await createBreakdown({
    projectId: existing?.id ?? null,
    project,
    platform: fplatform(fd),
    productionType: fstr(fd, "productionType", 100),
    unionStatus: fstr(fd, "unionStatus", 100),
    region: fregion(fd),
    castingDirector: fstr(fd, "castingDirector", 300),
    castingOffice: fstr(fd, "castingOffice", 200),
    roleName: fstr(fd, "roleName", 200),
    roleType: fstr(fd, "roleType", 100),
    characterDescription: fstr(fd, "characterDescription", 4000),
    ageRange: fstr(fd, "ageRange", 60),
    gender: fstr(fd, "gender", 60),
    ethnicity: fstr(fd, "ethnicity", 200),
    postedDate: fdate(fd, "postedDate"),
    submissionDeadline: fdate(fd, "submissionDeadline"),
    visibility: visibility(fstr(fd, "visibility")),
    source,
    sourceUrl: furl(fd, "sourceUrl"),
    verified: fd.get("verified") === "on",
  });
  await updateBreakdownRelevance([b.id]);
  await audit("CREATE", "PublicBreakdown", b.id, `Added breakdown: ${project}${b.roleName ? ` — ${b.roleName}` : ""}`);
  await rerunUnreviewed();
  await generateAlerts();
  revalidatePath("/", "layout");
  redirect(`/opportunities/${b.id}?msg=Breakdown+saved`);
}

export async function updateBreakdownAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  const before = await prisma.publicBreakdown.findUniqueOrThrow({ where: { id } });
  const data = {
    roleName: fstr(fd, "roleName", 200),
    roleType: fstr(fd, "roleType", 100),
    characterDescription: fstr(fd, "characterDescription", 4000),
    ageRange: fstr(fd, "ageRange", 60),
    gender: fstr(fd, "gender", 60),
    ethnicity: fstr(fd, "ethnicity", 200),
    unionStatus: fstr(fd, "unionStatus", 100),
    region: fregion(fd),
    castingDirectorRaw: fstr(fd, "castingDirector", 300),
    castingOfficeRaw: fstr(fd, "castingOffice", 200),
    postedDate: fdate(fd, "postedDate"),
    submissionDeadline: fdate(fd, "submissionDeadline"),
    visibility: visibility(fstr(fd, "visibility")),
    source: fstr(fd, "source", 200) ?? before.source,
    sourceUrl: furl(fd, "sourceUrl"),
  };
  await prisma.publicBreakdown.update({ where: { id }, data });
  const changed = Object.keys(data).filter((k) => String((before as Record<string, unknown>)[k] ?? "") !== String((data as Record<string, unknown>)[k] ?? ""));
  await audit("EDIT", "PublicBreakdown", id, `Edited breakdown (${changed.join(", ") || "no changes"})`, { changed });
  await updateBreakdownRelevance([id]);
  revalidatePath("/", "layout");
  redirect(`/opportunities/${id}?msg=Changes+saved`);
}

export async function verifyBreakdownAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  const now = new Date();
  const b = await prisma.publicBreakdown.update({ where: { id }, data: { verifiedAt: now } });
  await prisma.project.update({ where: { id: b.projectId }, data: { verifiedAt: now } });
  await audit("EDIT", "PublicBreakdown", id, "Marked source as verified today");
  revalidatePath(`/opportunities/${id}`);
}

export async function closeBreakdownAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  await prisma.publicBreakdown.update({ where: { id }, data: { visibility: "CLOSED" } });
  await audit("EDIT", "PublicBreakdown", id, "Marked casting closed");
  revalidatePath(`/opportunities/${id}`);
}

export async function deleteBreakdownAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  if (fd.get("confirm") !== "yes") redirect(`/opportunities/${id}?error=Tick+the+confirmation+box+to+delete`);
  const b = await prisma.publicBreakdown.delete({ where: { id }, include: { project: true } });
  await audit("DELETE", "PublicBreakdown", id, `Deleted breakdown: ${b.project.title}${b.roleName ? ` — ${b.roleName}` : ""}`);
  await rerunUnreviewed();
  revalidatePath("/", "layout");
  redirect("/opportunities?msg=Deleted");
}
