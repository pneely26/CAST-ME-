"use server";

import { revalidatePath } from "next/cache";
import { actorOrThrow } from "@/server/auth";
import { toResult, type ActionResult } from "@/server/errors";
import { bool, ids } from "@/server/form";
import { markRead } from "@/server/services/notifications";
import { runReminders } from "@/server/services/reminders";
import { assertCan } from "@/server/policy";

export async function markReadAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const all = bool(fd, "all");
    const r = await markRead(actor, all ? "all" : ids(fd), !bool(fd, "unread"));
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: `${r.count} notification(s) updated` };
  } catch (e) {
    return toResult(e);
  }
}

export async function runRemindersAction(): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    assertCan(actor, "settings.manage", "Only the coordinator can run reminders manually.");
    const r = await runReminders();
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: `Reminders checked: ${r.created} new in-app notification(s).` };
  } catch (e) {
    return toResult(e);
  }
}
