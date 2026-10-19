"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorOrThrow } from "@/server/auth";
import { toResult, type ActionResult } from "@/server/errors";
import { bool, ids, str } from "@/server/form";
import { saveScheduleEmailSettings, sendScheduleEmails } from "@/server/services/scheduleEmail";

export async function saveScheduleEmailSettingsAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await saveScheduleEmailSettings(actor, { enabled: bool(fd, "enabled"), time: str(fd, "time", 5) ?? "", skipWeekends: bool(fd, "skipWeekends") });
    revalidatePath("/schedule/email");
    return { ok: true, data: undefined, message: "Saved" };
  } catch (e) {
    return toResult(e);
  }
}

export async function sendScheduleEmailsAction(_: unknown, fd: FormData): Promise<ActionResult> {
  let to: string;
  try {
    const actor = await actorOrThrow();
    const date = str(fd, "date", 10) ?? "";
    const reps = ids(fd, "reps");
    if (!reps.length) throw new Error("Tick at least one rep.");
    const r = await sendScheduleEmails(actor, date, reps);
    const sent = r.filter((x) => x.status === "sent");
    const parts = [
      sent.length && `Emailed ${sent.map((x) => x.repName).join(", ")}`,
      r.filter((x) => x.status === "skipped").length && `${r.filter((x) => x.status === "skipped").map((x) => x.repName).join(", ")}: nothing scheduled, not sent`,
      r.filter((x) => x.status === "failed").length && `Couldn't send to ${r.filter((x) => x.status === "failed").map((x) => `${x.repName} (${x.reason})`).join(", ")}`,
    ].filter(Boolean);
    revalidatePath("/schedule/email");
    to = `/schedule/email?date=${date}&msg=${encodeURIComponent(parts.join(". ") || "Nothing sent")}${r.some((x) => x.status === "failed") ? "&tone=bad" : ""}`;
  } catch (e) {
    return toResult(e);
  }
  redirect(to);
}
