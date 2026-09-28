"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { WatchType } from "@prisma/client";
import { requireUser } from "@/lib/server/auth";
import { addWatch, removeWatch } from "@/lib/server/watchlist";
import { fstr } from "@/lib/server/forms";
import { WATCH_TYPES, parseRegion, canonicalPlatform } from "@/lib/constants";
import { prisma } from "@/lib/server/db";

function safeBack(v: string | null) {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/watchlist";
}

export async function toggleWatchAction(fd: FormData) {
  await requireUser();
  const watchId = fstr(fd, "watchId", 64);
  const back = safeBack(fstr(fd, "back", 300));
  if (watchId) await removeWatch(watchId);
  else {
    const type = fstr(fd, "type", 40) as WatchType;
    if (!(WATCH_TYPES as readonly string[]).includes(type)) throw new Error("Invalid watch type");
    await addWatch(type, fstr(fd, "value", 200) ?? "", {
      castingDirectorId: fstr(fd, "castingDirectorId", 64) ?? undefined,
      projectId: fstr(fd, "projectId", 64) ?? undefined,
    });
  }
  revalidatePath("/", "layout");
  redirect(back);
}

export async function addWatchAction(fd: FormData) {
  await requireUser();
  const type = fstr(fd, "type", 40) as WatchType;
  if (!(WATCH_TYPES as readonly string[]).includes(type)) redirect("/watchlist?error=Choose+a+watch+type");
  let value = fstr(fd, "value", 200) ?? "";
  const refs: { castingDirectorId?: string; projectId?: string } = {};
  if (type === "CASTING_DIRECTOR") {
    const id = fstr(fd, "castingDirectorId", 64);
    const cd = id ? await prisma.castingDirector.findUnique({ where: { id } }) : null;
    if (!cd) redirect("/watchlist?error=Choose+a+casting+director");
    value = cd.name;
    refs.castingDirectorId = cd.id;
  } else if (type === "PROJECT") {
    const id = fstr(fd, "projectId", 64);
    const p = id ? await prisma.project.findUnique({ where: { id } }) : null;
    if (!p) redirect("/watchlist?error=Choose+a+project");
    value = p.title;
    refs.projectId = p.id;
  } else if (type === "REGION") {
    value = parseRegion(fstr(fd, "region", 40)) ?? "";
  } else if (type === "PLATFORM") {
    value = canonicalPlatform(fstr(fd, "platformCustom", 80) ?? fstr(fd, "platform", 80)) ?? "";
  }
  if (!value) redirect("/watchlist?error=A+value+is+required");
  await addWatch(type, value, refs);
  revalidatePath("/", "layout");
  redirect("/watchlist?msg=Added+to+watchlist");
}
