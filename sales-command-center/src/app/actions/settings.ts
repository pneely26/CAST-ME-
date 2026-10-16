"use server";

import { revalidatePath } from "next/cache";
import { actorOrThrow, setSessionCookie } from "@/server/auth";
import { toResult, type ActionResult } from "@/server/errors";
import { id, str, strOrNull } from "@/server/form";
import { saveSettings } from "@/server/services/settingsAdmin";
import * as users from "@/server/services/users";
import { loadDemoData, removeDemoData } from "@/server/services/demo";

const done = () => revalidatePath("/", "layout");
const ok = (message: string): ActionResult => ({ ok: true, data: undefined, message });

export async function saveSettingsAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const keys = ["businessName", "timezone", "staleVisitDays", "defaultAppointmentMinutes", "duplicateAppointmentWindowMinutes", "reminderMinutesBefore", "weekStartsOn"];
    await saveSettings(actor, Object.fromEntries(keys.map((k) => [k, str(fd, k, 100) ?? ""])));
    done();
    return ok("Settings saved");
  } catch (e) {
    return toResult(e);
  }
}

const userFields = (fd: FormData) => ({ name: str(fd, "name", 120) ?? "", email: str(fd, "email", 200) ?? "", role: str(fd, "role", 20) ?? "", phone: strOrNull(fd, "phone", 40) });

export async function createUserAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const u = await users.createUser(actor, { ...userFields(fd), password: (fd.get("password") as string) ?? "" });
    done();
    return ok(`Added ${u.name}. Share the temporary password with them privately; they can change it under Settings → My account.`);
  } catch (e) {
    return toResult(e);
  }
}

export async function updateUserAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await users.updateUser(actor, id(fd), userFields(fd));
    done();
    return ok("User updated");
  } catch (e) {
    return toResult(e);
  }
}

export async function setUserActiveAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const active = str(fd, "active") === "1";
    const r = await users.setUserActive(actor, id(fd), active);
    done();
    return ok(active ? "User reactivated" : `User deactivated and signed out.${r.assignedLeads ? ` They still have ${r.assignedLeads} assigned lead(s) — reassign them from the Leads page.` : ""}`);
  } catch (e) {
    return toResult(e);
  }
}

export async function resetPasswordAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await users.resetPassword(actor, id(fd), (fd.get("password") as string) ?? "");
    done();
    return ok("Password reset. They've been signed out everywhere and must use the new password.");
  } catch (e) {
    return toResult(e);
  }
}

export async function changeOwnPasswordAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const next = (fd.get("password") as string) ?? "";
    if (next !== fd.get("confirm")) throw new Error("The new passwords don't match.");
    const u = await users.changeOwnPassword(actor, (fd.get("current") as string) ?? "", next);
    await setSessionCookie(u); // stay signed in here; other devices are signed out
    return ok("Password changed. Other devices have been signed out.");
  } catch (e) {
    return toResult(e);
  }
}

export async function demoAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    if (str(fd, "op") === "remove") {
      const r = await removeDemoData(actor);
      done();
      return ok(`Removed demo data: ${r.leads} lead(s) and ${r.visits} visit(s). Real records were not changed.`);
    }
    const s = await loadDemoData(actor);
    done();
    return ok(`Loaded demo data: ${s.leads} labeled demo lead(s) and ${s.opps} opportunity(ies).`);
  } catch (e) {
    return toResult(e);
  }
}
