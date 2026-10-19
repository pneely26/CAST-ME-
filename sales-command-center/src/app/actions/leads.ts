"use server";

import { revalidatePath } from "next/cache";
import type { LeadPriority, LeadStatus } from "@prisma/client";
import type { Actor } from "@/server/policy";
import { invalid } from "@/server/errors";
import { getSettings } from "@/server/settings";
import { areaForCity } from "@/server/services/imports";
import { createAppointmentInTx } from "@/server/services/appointments";
import { dayRangeUtc, isDateKey, isTime, zonedToUtc } from "@/lib/time";
import { actorOrThrow } from "@/server/auth";
import { toResult, type ActionResult } from "@/server/errors";
import { assignLeads, bulkUpdate, createLead, updateLead, archiveLeads, type BulkAction, type LeadInput } from "@/server/services/leads";
import { prisma } from "@/server/db";
import { bool, id, ids, str, strOrNull, int } from "@/server/form";

const LEAD_TEXT_FIELDS: [keyof LeadInput, number][] = [
  ["contactName", 120], ["jobTitle", 120], ["phone", 40], ["cellPhone", 40], ["email", 200], ["address", 300], ["address2", 300], ["city", 100], ["state", 40], ["zip", 20], ["country", 60],
  ["industry", 120], ["assignedRepId", 40], ["externalId", 60], ["employeeCount", 12], ["businessVolume", 30], ["problems", 2000], ["yearsInBusiness", 6],
  ["bcName", 120], ["bcNumber", 40], ["bcCoDirector1", 120], ["bcCoDirector2", 120], ["notes", 10000],
];

/** Only the fields the form actually sent — anything not on the form keeps its saved value. */
function leadFields(fd: FormData): LeadInput {
  const out: Record<string, unknown> = { businessName: str(fd, "businessName", 200) ?? "" };
  for (const [k, max] of LEAD_TEXT_FIELDS) if (fd.has(k)) out[k] = strOrNull(fd, k, max);
  return out as LeadInput;
}

/** Area = the city, territory = the state (created if needed), same as imports. */
async function placeByCity(actor: Actor, input: LeadInput) {
  const placed = await areaForCity(actor, input.city, input.state);
  return placed ? { areaId: placed.areaId, territoryId: placed.territoryId } : {};
}

export async function createLeadAction(_: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await actorOrThrow();
    const input = leadFields(fd);
    const apptDate = str(fd, "apptDate", 10);
    const apptTime = str(fd, "apptTime", 5);
    if (apptDate && !isDateKey(apptDate)) throw invalid("Appointment date isn't a valid date.");
    if (apptTime && !isTime(apptTime)) throw invalid("Appointment time isn't a valid time.");
    if (apptDate && !input.assignedRepId) throw invalid("Choose the Sales Rep for the appointment (or leave the date blank).");
    const placed = await placeByCity(actor, input);
    const settings = await getSettings();
    const lead = await prisma.$transaction(async (tx) => {
      const lead = await createLead(actor, { ...input, ...placed }, { allowDuplicate: bool(fd, "allowDuplicate"), tx });
      if (apptDate) {
        const timed = apptTime
          ? (() => { const startAt = zonedToUtc(apptDate, apptTime, settings.timezone); return { startAt, endAt: new Date(startAt.getTime() + settings.defaultAppointmentMinutes * 60_000), timeSet: true }; })()
          : { ...(({ start, end }) => ({ startAt: start, endAt: end }))(dayRangeUtc(apptDate, apptDate, settings.timezone)), timeSet: false };
        await createAppointmentInTx(tx, actor, { leadId: lead.id, repId: input.assignedRepId, ...timed, allowOverlap: true, confirmed: bool(fd, "apptConfirmed"), confirmedBy: strOrNull(fd, "apptConfirmedBy", 120) });
      }
      return lead;
    });
    revalidatePath("/", "layout");
    return { ok: true, data: { id: lead.id }, message: "Lead created", redirect: `/leads/${lead.id}?msg=${apptDate ? "Lead+created+and+appointment+booked" : "Lead+created"}` };
  } catch (e) {
    const r = toResult(e);
    if (r.code === "CONFLICT" && !r.error.includes("appointment")) r.error += " Tick “Create anyway” if this really is a different business.";
    return r;
  }
}

export async function updateLeadAction(_: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await actorOrThrow();
    const leadId = id(fd);
    const version = int(fd, "version");
    let input: Partial<LeadInput> = actor.role === "COORDINATOR" ? leadFields(fd) : { contactName: strOrNull(fd, "contactName", 120), jobTitle: strOrNull(fd, "jobTitle", 120), phone: strOrNull(fd, "phone", 40), email: strOrNull(fd, "email", 200), status: (str(fd, "status") || undefined) as LeadStatus | undefined };
    if (actor.role === "COORDINATOR") {
      // a new city or state moves the lead to that city's area
      const cur = await prisma.lead.findUnique({ where: { id: leadId }, select: { city: true, state: true } });
      const norm = (x: string | null | undefined) => (x ?? "").trim().toLowerCase();
      if (cur && (norm(cur.city) !== norm(input.city) || norm(cur.state) !== norm(input.state))) input = { ...input, areaId: null, territoryId: null, ...(await placeByCity(actor, input as LeadInput)) };
    }
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
