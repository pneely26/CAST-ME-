"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorOrThrow } from "@/server/auth";
import { toResult, type ActionResult } from "@/server/errors";
import { id, ids, str, strOrNull } from "@/server/form";
import { IMPORT_FIELDS } from "@/lib/domain/imports";
import { prisma } from "@/server/db";
import * as svc from "@/server/services/imports";

const done = () => revalidatePath("/", "layout");

/** Redirect back to the review page (keeping its filters) with a message, so feedback survives the row disappearing. */
function backTo(fd: FormData, msg: string): string | undefined {
  const b = str(fd, "back", 500);
  if (!b || !/^\/import\/[a-z0-9]+(\?[^#]*)?$/i.test(b)) return undefined;
  const u = new URL(b, "http://x");
  u.searchParams.set("msg", msg);
  return u.pathname + u.search;
}

function fieldValues(fd: FormData) {
  return Object.fromEntries(IMPORT_FIELDS.filter((f) => fd.has(f)).map((f) => [f, (fd.get(f) as string | null) ?? ""]));
}

function defaults(fd: FormData): svc.ImportDefaults {
  return { assignedRepId: strOrNull(fd, "assignedRepId", 40), areaId: strOrNull(fd, "areaId", 40), source: strOrNull(fd, "source", 120) };
}

export async function uploadScreenshotsAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
    const batch = await svc.createScreenshotBatch(actor, files, strOrNull(fd, "notes", 1000));
    done();
    return { ok: true, data: undefined, message: "Uploaded", redirect: `/import/${batch.id}` };
  } catch (e) {
    return toResult(e);
  }
}

export async function uploadCsvAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const file = fd.get("file");
    if (!file || typeof file === "string") throw new Error("Choose a CSV file.");
    const batch = await svc.createCsvBatch(actor, file);
    done();
    return { ok: true, data: undefined, message: "Uploaded", redirect: `/import/${batch.id}` };
  } catch (e) {
    return toResult(e);
  }
}

/** Called by the review page once per image so progress can be shown. */
export async function extractImageAction(imageId: string): Promise<ActionResult<{ status: string; count: number }>> {
  try {
    const actor = await actorOrThrow();
    const r = await svc.extractImage(actor, imageId);
    const img = await prisma.importImage.findUnique({ where: { id: imageId }, select: { batchId: true } });
    if (img) await svc.maybeComplete(img.batchId);
    return { ok: true, data: { status: r.status, count: r.count }, message: r.status === "ERROR" ? (r as { error?: string }).error : undefined };
  } catch (e) {
    return toResult(e);
  }
}

export async function saveRecordAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await svc.saveRecordEdits(actor, id(fd), fieldValues(fd));
    done();
    return { ok: true, data: undefined, message: "Corrections saved" };
  } catch (e) {
    return toResult(e);
  }
}

async function decideRecordActionInner(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const recordId = id(fd);
    const decision = str(fd, "decision", 80);
    // save any corrections made in the same form first
    if (IMPORT_FIELDS.some((f) => fd.has(f))) await svc.saveRecordEdits(actor, recordId, fieldValues(fd));
    let message = "";
    if (decision === "save") message = "Corrections saved";
    else if (decision === "create" || decision === "create-duplicate") {
      const res = await svc.importAsNew(actor, recordId, defaults(fd), decision === "create-duplicate");
      message = `${res.merged ? "Added to existing lead" : "Created lead"} #${res.lead.leadNumber} ${res.lead.businessName}${res.note ? ` · ${res.note}` : ""}`;
    } else if (decision?.startsWith("merge:")) {
      const leadId = decision.slice(6);
      if (!/^[a-z0-9]{10,40}$/i.test(leadId)) throw new Error("Invalid lead");
      const r = await svc.mergeInto(actor, recordId, leadId, defaults(fd));
      message = r.filled.length ? `Merged — filled ${r.filled.join(", ")}` : "Merged — the lead already had this information";
      if (r.note) message += ` · ${r.note}`;
    } else if (decision === "skip") {
      await svc.skipRecords(actor, [recordId]);
      message = "Row skipped";
    } else if (decision === "restore") {
      await svc.restoreRecord(actor, recordId);
      message = "Row restored for review";
    } else throw new Error("Unknown decision");
    const rec = await prisma.importRecord.findUnique({ where: { id: recordId }, select: { batchId: true } });
    if (rec) await svc.maybeComplete(rec.batchId);
    done();
    return { ok: true, data: undefined, message, redirect: backTo(fd, message) };
  } catch (e) {
    return toResult(e);
  }
}

export async function decideRecordAction(prev: unknown, fd: FormData): Promise<ActionResult> {
  const r = await decideRecordActionInner(prev, fd);
  // server-side redirect: the row's form may unmount on refresh before a client redirect could run
  if (r.ok && r.redirect) redirect(r.redirect);
  return r;
}

export async function skipManyAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const n = await svc.skipRecords(actor, ids(fd));
    await svc.maybeComplete(id(fd, "batchId"));
    done();
    return { ok: true, data: undefined, message: `${n} row(s) skipped` };
  } catch (e) {
    return toResult(e);
  }
}

async function importCleanActionInner(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const r = await svc.importCleanRows(actor, id(fd, "batchId"), defaults(fd));
    done();
    const summary = `Created ${r.imported} new lead(s)${r.merged ? `, updated ${r.merged} existing lead(s)` : ""}${r.appointments ? `, added ${r.appointments} appointment(s)` : ""}. ${r.left} left for review${r.duplicates ? ` (${r.duplicates} matched an existing lead)` : ""}.`;
    if (r.failed) return { ok: false, error: `${summary} ${r.failed} failed: ${r.errors.slice(0, 3).join(" · ")}` };
    return { ok: true, data: undefined, message: summary, redirect: backTo(fd, summary) };
  } catch (e) {
    return toResult(e);
  }
}

export async function importCleanAction(prev: unknown, fd: FormData): Promise<ActionResult> {
  const r = await importCleanActionInner(prev, fd);
  // server-side redirect: the row's form may unmount on refresh before a client redirect could run
  if (r.ok && r.redirect) redirect(r.redirect);
  return r;
}

export async function remapCsvAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const batchId = id(fd, "batchId");
    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    const meta = batch && svc.csvMeta(batch);
    if (!meta) throw new Error("CSV import not found");
    const mapping = Object.fromEntries(meta.headers.map((h, i) => [h, str(fd, `map_${i}`, 40) ?? ""]));
    await svc.remapCsv(actor, batchId, mapping);
    done();
    return { ok: true, data: undefined, message: "Column mapping updated for rows still under review" };
  } catch (e) {
    return toResult(e);
  }
}

export async function addManualRecordAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await svc.addManualRecord(actor, id(fd, "batchId"), strOrNull(fd, "imageId", 40), fieldValues(fd));
    done();
    return { ok: true, data: undefined, message: "Row added for review" };
  } catch (e) {
    return toResult(e);
  }
}

export async function retryImageAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await svc.requeueImage(actor, id(fd));
    done();
    return { ok: true, data: undefined, message: "Queued to be read again" };
  } catch (e) {
    return toResult(e);
  }
}
