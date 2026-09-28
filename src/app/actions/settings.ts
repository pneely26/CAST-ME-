"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { getProfile, updateBreakdownRelevance } from "@/lib/server/profile";
import { flist, fstr, fid } from "@/lib/server/forms";
import { DEFAULT_PLATFORMS } from "@/lib/constants";
import { generateAlerts } from "@/lib/alerts/engine";

export async function updateProfileAction(fd: FormData) {
  await requireUser();
  const before = await getProfile();
  const min = Number(fstr(fd, "playingAgeMin", 3));
  const max = Number(fstr(fd, "playingAgeMax", 3));
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 120 || min > max) redirect("/settings?error=Playing+age+range+is+invalid");
  const data = {
    name: fstr(fd, "name", 100) ?? before.name,
    profession: fstr(fd, "profession", 100) ?? "",
    union: fstr(fd, "union", 100) ?? "",
    location: fstr(fd, "location", 100) ?? "",
    castingRange: fstr(fd, "castingRange", 60) ?? "",
    playingAgeMin: min,
    playingAgeMax: max,
    gender: fstr(fd, "gender", 60) ?? "",
    castingProfile: fstr(fd, "castingProfile", 300) ?? "",
    primaryWork: flist(fd, "primaryWork"),
    training: flist(fd, "training"),
    additional: flist(fd, "additional"),
    targetMarkets: flist(fd, "targetMarkets"),
    targetPlatforms: flist(fd, "targetPlatforms"),
    roleTypes: flist(fd, "roleTypes"),
  };
  await prisma.actorProfile.update({ where: { id: "default" }, data });
  await audit("EDIT", "ActorProfile", "default", "Updated actor profile");
  const n = await updateBreakdownRelevance();
  await generateAlerts();
  revalidatePath("/", "layout");
  redirect(`/settings?msg=Profile+saved.+Recomputed+relevance+for+${n}+breakdown(s).`);
}

export async function addPlatformAction(fd: FormData) {
  await requireUser();
  const name = fstr(fd, "name", 80);
  if (!name) redirect("/settings?error=Platform+name+required");
  if (DEFAULT_PLATFORMS.some((p) => p.toLowerCase() === name.toLowerCase())) redirect("/settings?error=That+platform+already+exists");
  await prisma.platform.upsert({ where: { name }, update: {}, create: { name, isCustom: true } });
  await audit("CREATE", "Platform", null, `Added custom platform: ${name}`);
  revalidatePath("/settings");
  redirect("/settings?msg=Platform+added#platforms");
}

export async function removePlatformAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  const p = await prisma.platform.delete({ where: { id } });
  await audit("DELETE", "Platform", id, `Removed custom platform: ${p.name}`);
  revalidatePath("/settings");
  redirect("/settings?msg=Platform+removed#platforms");
}

export async function removeDemoDataAction(fd: FormData) {
  await requireUser();
  if (fd.get("confirm") !== "yes") redirect("/settings?error=Tick+the+confirmation+box+to+remove+demo+data#demo");
  const counts = {
    submissions: (await prisma.agencySubmission.deleteMany({ where: { isDemo: true } })).count,
    projects: (await prisma.project.deleteMany({ where: { isDemo: true } })).count,
    castingDirectors: (await prisma.castingDirector.deleteMany({ where: { isDemo: true, castings: { none: { project: { isDemo: false } } } } })).count,
  };
  await prisma.alert.deleteMany({});
  await audit("DELETE", "DemoData", null, `Removed demo data (${counts.projects} projects, ${counts.submissions} submissions, ${counts.castingDirectors} casting directors)`, counts);
  await generateAlerts();
  revalidatePath("/", "layout");
  redirect("/settings?msg=Demo+data+removed");
}
