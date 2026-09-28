"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { normalizeCastingDirector } from "@/lib/normalize";
import { fid, fstr, furl } from "@/lib/server/forms";

function fields(fd: FormData) {
  return {
    castingOffice: fstr(fd, "castingOffice", 200),
    city: fstr(fd, "city", 100),
    state: fstr(fd, "state", 60),
    website: furl(fd, "website"),
    sourceUrl: furl(fd, "sourceUrl"),
    sourceName: fstr(fd, "sourceName", 200),
    notes: fstr(fd, "notes", 4000),
  };
}

export async function createCastingDirectorAction(fd: FormData) {
  await requireUser();
  const name = fstr(fd, "name", 200);
  if (!name) redirect("/casting-directors/new?error=Name+is+required");
  const normalizedName = normalizeCastingDirector(name);
  const existing = await prisma.castingDirector.findUnique({ where: { normalizedName } });
  if (existing) redirect(`/casting-directors/${existing.id}?msg=This+casting+director+already+exists`);
  const cd = await prisma.castingDirector.create({
    data: { name, normalizedName, ...fields(fd), verifiedAt: fd.get("verified") === "on" ? new Date() : null },
  });
  await audit("CREATE", "CastingDirector", cd.id, `Added casting director: ${name}`);
  if (fd.get("watch") === "on") {
    const { addWatch } = await import("@/lib/server/watchlist");
    await addWatch("CASTING_DIRECTOR", cd.name, { castingDirectorId: cd.id });
  }
  revalidatePath("/", "layout");
  redirect(`/casting-directors/${cd.id}?msg=Saved`);
}

export async function updateCastingDirectorAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  const name = fstr(fd, "name", 200);
  if (!name) redirect(`/casting-directors/${id}?error=Name+is+required`);
  const normalizedName = normalizeCastingDirector(name);
  const clash = await prisma.castingDirector.findFirst({ where: { normalizedName, id: { not: id } } });
  if (clash) redirect(`/casting-directors/${id}?error=Another+record+already+uses+that+name`);
  await prisma.castingDirector.update({
    where: { id },
    data: { name, normalizedName, ...fields(fd), ...(fd.get("verified") === "on" ? { verifiedAt: new Date() } : {}) },
  });
  await audit("EDIT", "CastingDirector", id, `Edited casting director: ${name}`);
  revalidatePath("/", "layout");
  redirect(`/casting-directors/${id}?msg=Saved`);
}

export async function deleteCastingDirectorAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  if (fd.get("confirm") !== "yes") redirect(`/casting-directors/${id}?error=Tick+the+confirmation+box+to+delete`);
  const cd = await prisma.castingDirector.delete({ where: { id } });
  await audit("DELETE", "CastingDirector", id, `Deleted casting director: ${cd.name}`);
  revalidatePath("/", "layout");
  redirect("/casting-directors");
}
