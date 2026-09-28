"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { fid } from "@/lib/server/forms";
import { runMonitor } from "@/lib/server/monitor";

export async function markAlertReadAction(fd: FormData) {
  await requireUser();
  await prisma.alert.update({ where: { id: fid(fd) }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

export async function markAllReadAction() {
  await requireUser();
  await prisma.alert.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

export async function runMonitorAction() {
  await requireUser();
  await runMonitor();
  revalidatePath("/", "layout");
}
