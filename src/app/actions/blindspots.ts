"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { resolveBlindSpot, rerunUnreviewed } from "@/lib/server/detection";
import { generateAlerts } from "@/lib/alerts/engine";
import { fid, fstr } from "@/lib/server/forms";

export async function resolveBlindSpotAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  const decision = fstr(fd, "decision", 40);
  if (!decision || !["SAME_AS_CANDIDATE", "NOT_FOUND", "DISMISS", "REOPEN"].includes(decision)) throw new Error("Invalid decision");
  if (decision === "SAME_AS_CANDIDATE" && fd.get("confirm") !== "yes") {
    redirect(`/blind-spots/${id}?error=Confirm+that+these+are+the+same+project+before+linking`);
  }
  await resolveBlindSpot(id, decision as "SAME_AS_CANDIDATE", {
    candidateProjectId: fstr(fd, "candidateProjectId", 64) ?? undefined,
    notes: fstr(fd, "notes", 4000) ?? undefined,
  });
  revalidatePath("/", "layout");
  redirect(`/blind-spots/${id}?msg=Review+saved`);
}

export async function saveBlindSpotNotesAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  await prisma.blindSpot.update({ where: { id }, data: { notes: fstr(fd, "notes", 4000) } });
  await audit("EDIT", "BlindSpot", id, "Updated blind spot notes");
  revalidatePath(`/blind-spots/${id}`);
  redirect(`/blind-spots/${id}?msg=Notes+saved`);
}

export async function rerunDetectionAction() {
  await requireUser();
  const n = await rerunUnreviewed();
  await generateAlerts();
  revalidatePath("/", "layout");
  redirect(`/blind-spots?msg=Re-ran+detection+for+${n}+unreviewed+submission(s)`);
}
