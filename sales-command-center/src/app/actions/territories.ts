"use server";

import { revalidatePath } from "next/cache";
import { actorOrThrow } from "@/server/auth";
import { toResult, type ActionResult } from "@/server/errors";
import { archiveTerritoryOrArea, saveArea, saveTerritory } from "@/server/services/territories";
import { id, str, strOrNull } from "@/server/form";

export async function saveTerritoryAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await saveTerritory(actor, { id: strOrNull(fd, "id", 40) ?? undefined, name: str(fd, "name", 100) ?? "", color: str(fd, "color", 7), notes: strOrNull(fd, "notes", 2000) });
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: "Territory saved" };
  } catch (e) {
    return toResult(e);
  }
}

export async function saveAreaAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await saveArea(actor, { id: strOrNull(fd, "id", 40) ?? undefined, territoryId: str(fd, "territoryId", 40) ?? "", name: str(fd, "name", 100) ?? "", notes: strOrNull(fd, "notes", 2000) });
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: "Area saved" };
  } catch (e) {
    return toResult(e);
  }
}

export async function archiveTerritoryAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const kind = str(fd, "kind") === "area" ? "area" : "territory";
    await archiveTerritoryOrArea(actor, kind, id(fd), str(fd, "archive") !== "false");
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: "Saved" };
  } catch (e) {
    return toResult(e);
  }
}
