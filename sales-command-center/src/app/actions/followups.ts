"use server";

import { revalidatePath } from "next/cache";
import { actorOrThrow } from "@/server/auth";
import { toResult, invalid, type ActionResult } from "@/server/errors";
import { createFollowUp, rescheduleFollowUp, setFollowUpStatus } from "@/server/services/followups";
import { getSettings } from "@/server/settings";
import { id, str, strOrNull, zonedDate } from "@/server/form";

export async function createFollowUpAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const tz = (await getSettings()).timezone;
    const dueAt = zonedDate(fd, "dueDate", "dueTime", tz, "09:00");
    if (!dueAt) throw invalid("Choose a due date.");
    await createFollowUp(actor, { leadId: id(fd, "leadId"), dueAt, action: str(fd, "action", 500) ?? "", assignedToId: strOrNull(fd, "assignedToId", 40) });
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: "Follow-up added" };
  } catch (e) {
    return toResult(e);
  }
}

export async function followUpStatusAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const status = str(fd, "status");
    if (status !== "DONE" && status !== "CANCELED" && status !== "OPEN") throw invalid("Invalid status");
    await setFollowUpStatus(actor, id(fd), status, strOrNull(fd, "note", 500) ?? undefined);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: status === "DONE" ? "Marked done" : status === "CANCELED" ? "Canceled" : "Reopened" };
  } catch (e) {
    return toResult(e);
  }
}

export async function moveFollowUpAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const tz = (await getSettings()).timezone;
    const dueAt = zonedDate(fd, "dueDate", "dueTime", tz);
    if (!dueAt) throw invalid("Choose a new date.");
    await rescheduleFollowUp(actor, id(fd), dueAt);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: "Follow-up moved" };
  } catch (e) {
    return toResult(e);
  }
}
