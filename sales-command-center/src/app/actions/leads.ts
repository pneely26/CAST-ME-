"use server";

import { revalidatePath } from "next/cache";
import type { LeadPriority, LeadStatus } from "@prisma/client";
import { actorOrThrow } from "@/server/auth";
import { toResult, type ActionResult } from "@/server/errors";
import { assignLeads, bulkUpdate, createLead, updateLead, archiveLeads, type BulkAction, type LeadInput } from "@/server/services/leads";
import { prisma } from "@/server/db";
import { bool, id, ids, str, strOrNull, tags, int } from "@/server/form";

function leadFields(fd: FormData): LeadInput {
  return {
    businessName: str(fd, "businessName", 200) ?? "",
    contactName: strOrNull(fd, "contactName", 120),
    jobTitle: strOrNull(fd, "jobTitle", 120),
    phone: strOrNull(fd, "phone", 40),
    email: strOrNull(fd, "email", 200),
    address: strOrNull(fd, "address", 300),
    city: strOrNull(fd, "city", 100),
    state: strOrNull(fd, "state", 40),
    zip: strOrNull(fd, "zip", 20),
    territoryId: strOrNull(fd, "territoryId", 40),
    areaId: strOrNull(fd, "areaId", 40),
    source: strOrNull(fd, "source", 120),
    industry: strOrNull(fd, "industry", 120),
    assignedRepId: strOrNull(fd, "assignedRepId", 40),
    priority: (str(fd, "priority") || "NORMAL") as LeadPriority,
    status: (str(fd, "status") || "NEW") as LeadStatus,
    estimatedValue: strOrNull(fd, "estimatedValue", 30),
    notes: strOrNull(fd, "notes", 10000),
    tags: tags(fd),
  };
}

export async function createLeadAction(_: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await actorOrThrow();
    const lead = await createLead(actor, leadFields(fd), { allowDuplicate: bool(fd, "allowDuplicate") });
    revalidatePath("/", "layout");
    return { ok: true, data: { id: lead.id }, message: "Lead created", redirect: `/leads/${lead.id}?msg=Lead+created` };
  } catch (e) {
    const r = toResult(e);
    if (r.code === "CONFLICT") r.error += " Tick “Create anyway” if this really is a different business.";
    return r;
  }
}

export async function updateLeadAction(_: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await actorOrThrow();
    const leadId = id(fd);
    const version = int(fd, "version");
    const input = actor.role === "COORDINATOR" ? leadFields(fd) : { contactName: strOrNull(fd, "contactName", 120), jobTitle: strOrNull(fd, "jobTitle", 120), phone: strOrNull(fd, "phone", 40), email: strOrNull(fd, "email", 200), status: (str(fd, "status") || undefined) as LeadStatus | undefined };
    await updateLead(actor, leadId, input, version);
    revalidatePath("/", "layout");
    return { ok: true, data: { id: leadId }, message: "Saved", redirect: `/leads/${leadId}?msg=Saved` };
  } catch (e) {
    return toResult(e);
  }
}

export async function setStatusAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const leadId = id(fd);
    await updateLead(actor, leadId, { status: str(fd, "status") as LeadStatus });
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: "Status updated" };
  } catch (e) {
    return toResult(e);
  }
}

export async function bulkLeadAction(_: unknown, fd: FormData): Promise<ActionResult<{ count: number }>> {
  try {
    const actor = await actorOrThrow();
    const selected = ids(fd);
    const kind = str(fd, "bulk");
    let action: BulkAction;
    switch (kind) {
      case "assign":
        action = { kind, repId: strOrNull(fd, "repId", 40) };
        break;
      case "status":
        action = { kind, status: str(fd, "status") as LeadStatus };
        break;
      case "priority":
        action = { kind, priority: str(fd, "priority") as LeadPriority };
        break;
      case "area":
        action = { kind, areaId: strOrNull(fd, "areaId", 40) };
        break;
      case "tag":
        action = { kind, tag: str(fd, "tag", 40) ?? "" };
        break;
      case "archive":
      case "restore":
        action = { kind };
        break;
      default:
        return { ok: false, error: "Choose a bulk action." };
    }
    const count = await bulkUpdate(actor, selected, action);
    revalidatePath("/", "layout");
    return { ok: true, data: { count }, message: `Updated ${count} lead(s).` };
  } catch (e) {
    return toResult(e);
  }
}

export async function assignLeadAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await assignLeads(actor, [id(fd)], strOrNull(fd, "repId", 40));
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: "Assignment updated" };
  } catch (e) {
    return toResult(e);
  }
}

export async function archiveLeadAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const leadId = id(fd);
    const archive = str(fd, "archive") !== "false";
    await archiveLeads(actor, [leadId], archive);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: archive ? "Lead archived — its history is kept." : "Lead restored", redirect: archive ? "/leads?msg=Lead+archived" : `/leads/${leadId}` };
  } catch (e) {
    return toResult(e);
  }
}

export async function saveViewAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const name = str(fd, "name", 60);
    const query = (str(fd, "query", 1000) ?? "").replace(/^\?/, "");
    if (!name) return { ok: false, error: "Give the view a name." };
    const clean = new URLSearchParams(query);
    clean.delete("page");
    clean.delete("msg");
    await prisma.savedView.upsert({ where: { userId_name: { userId: actor.id, name } }, update: { query: clean.toString() }, create: { userId: actor.id, name, query: clean.toString() } });
    revalidatePath("/leads");
    return { ok: true, data: undefined, message: `Saved view “${name}”` };
  } catch (e) {
    return toResult(e);
  }
}

export async function deleteViewAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    await prisma.savedView.deleteMany({ where: { id: id(fd), userId: actor.id } });
    revalidatePath("/leads");
    return { ok: true, data: undefined };
  } catch (e) {
    return toResult(e);
  }
}
