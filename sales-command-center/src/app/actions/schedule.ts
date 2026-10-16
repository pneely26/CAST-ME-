"use server";

import { revalidatePath } from "next/cache";
import type { DayPlanStatus } from "@prisma/client";
import { actorOrThrow } from "@/server/auth";
import { toResult, invalid, type ActionResult } from "@/server/errors";
import { addStops, copyWeek, resetDayToTemplate, saveDayPlan, saveTemplate, setDayStatus, updateStop, weekToTemplate } from "@/server/services/schedule";
import { bool, id, ids, int, str, strOrNull } from "@/server/form";
import { isDateKey } from "@/lib/time";

function dateOf(fd: FormData, k = "date") {
  const d = str(fd, k, 10);
  if (!isDateKey(d)) throw invalid("Invalid date.");
  return d;
}

const done = (message: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message };
};

export async function saveDayAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await saveDayPlan(actor, strOrNull(fd, "repId", 40), dateOf(fd), {
      label: strOrNull(fd, "label", 100),
      areaId: strOrNull(fd, "areaId", 40),
      territoryId: strOrNull(fd, "territoryId", 40),
      startTime: strOrNull(fd, "startTime", 5),
      endTime: strOrNull(fd, "endTime", 5),
      visitTarget: int(fd, "visitTarget") ?? null,
      notes: strOrNull(fd, "notes", 2000),
      status: (strOrNull(fd, "status", 20) as DayPlanStatus | null) ?? undefined,
    });
    return done("Day plan saved");
  } catch (e) {
    return toResult(e);
  }
}

export async function dayStatusAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await setDayStatus(actor, strOrNull(fd, "repId", 40), dateOf(fd), str(fd, "status") as DayPlanStatus);
    return done("Day status updated");
  } catch (e) {
    return toResult(e);
  }
}

export async function resetDayAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await resetDayToTemplate(actor, strOrNull(fd, "repId", 40), dateOf(fd));
    return done("Back to the recurring plan");
  } catch (e) {
    return toResult(e);
  }
}

export async function addStopsAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const n = await addStops(actor, strOrNull(fd, "repId", 40), dateOf(fd), ids(fd, "leadIds"));
    return done(n ? `Added ${n} planned visit(s)` : "Those leads were already on this day");
  } catch (e) {
    return toResult(e);
  }
}

export async function stopAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const op = str(fd, "op");
    await updateStop(actor, id(fd), op === "remove" ? { remove: true } : op === "up" ? { move: -1 } : op === "down" ? { move: 1 } : op === "skip" ? { status: "SKIPPED", note: strOrNull(fd, "note", 300) } : { status: "PLANNED" });
    return done(op === "remove" ? "Removed from the plan" : op === "skip" ? "Marked skipped" : "Updated");
  } catch (e) {
    return toResult(e);
  }
}

export async function saveTemplateAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const days = [0, 1, 2, 3, 4, 5, 6].map((w) => ({
      weekday: w,
      label: strOrNull(fd, `label_${w}`, 100),
      areaId: strOrNull(fd, `areaId_${w}`, 40),
      territoryId: strOrNull(fd, `territoryId_${w}`, 40),
      startTime: strOrNull(fd, `startTime_${w}`, 5),
      endTime: strOrNull(fd, `endTime_${w}`, 5),
      visitTarget: int(fd, `visitTarget_${w}`) ?? null,
      notes: strOrNull(fd, `notes_${w}`, 2000),
    }));
    await saveTemplate(actor, strOrNull(fd, "repId", 40), days);
    return done("Recurring weekly plan saved. Days you changed individually keep their changes.");
  } catch (e) {
    return toResult(e);
  }
}

export async function copyWeekAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const n = await copyWeek(actor, strOrNull(fd, "repId", 40), dateOf(fd, "from"), dateOf(fd, "to"), bool(fd, "withStops"));
    return done(n ? `Copied ${n} day plan(s)` : "That week has no saved day plans to copy (it follows the recurring plan).");
  } catch (e) {
    return toResult(e);
  }
}

export async function weekToTemplateAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await weekToTemplate(actor, strOrNull(fd, "repId", 40), dateOf(fd, "weekStart"));
    return done("This week is now the recurring weekly plan.");
  } catch (e) {
    return toResult(e);
  }
}
