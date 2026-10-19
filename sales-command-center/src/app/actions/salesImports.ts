"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorOrThrow } from "@/server/auth";
import { toResult, type ActionResult } from "@/server/errors";
import { bool, id, ids, str, strOrNull } from "@/server/form";
import * as svc from "@/server/services/salesImports";

const done = () => revalidatePath("/", "layout");

function back(batchId: string, fd: FormData, msg: string) {
  const u = new URLSearchParams();
  const rep = str(fd, "rep", 200);
  if (rep) u.set("rep", rep);
  const as = str(fd, "as", 40);
  if (as) u.set("as", as);
  u.set("msg", msg);
  return `/import/sales/${batchId}?${u}`;
}

export async function uploadSalesReportAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const file = fd.get("file");
    if (!file || typeof file === "string") throw new Error("Choose the sales report PDF.");
    const batch = await svc.createSalesReportImport(actor, file);
    done();
    return { ok: true, data: undefined, message: "Uploaded", redirect: `/import/sales/${batch.id}` };
  } catch (e) {
    return toResult(e);
  }
}

export async function applySalesImportAction(_: unknown, fd: FormData): Promise<ActionResult> {
  let to: string;
  try {
    const actor = await actorOrThrow();
    const batchId = id(fd, "batchId");
    const chosen = ids(fd);
    if (str(fd, "decision") === "skip") {
      await svc.skipSalesRecords(actor, batchId, chosen);
      to = back(batchId, fd, `${chosen.length} skipped`);
    } else {
      const r = await svc.applySalesImport(actor, batchId, chosen, bool(fd, "confirmed"), strOrNull(fd, "as", 40));
      const parts = [r.created && `${r.created} sale(s) recorded`, r.updated && `${r.updated} updated`, r.unchanged && `${r.unchanged} already up to date`, r.blocked && `${r.blocked} couldn't be recorded`].filter(Boolean);
      to = back(batchId, fd, parts.join(", ") || "Nothing to record");
    }
    done();
  } catch (e) {
    return toResult(e);
  }
  redirect(to);
}
