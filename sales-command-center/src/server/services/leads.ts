import { z } from "zod";
import type { LeadPriority, LeadStatus, Prisma } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { audit, diff } from "../audit";
import { assertCan, assertLeadAccess, isCoordinator, leadScope, type Actor } from "../policy";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { normalizeAddress, normalizeBusinessName, normalizePhone, findDuplicates, isValidEmail } from "@/lib/normalize";
import { LEAD_STATUSES, LEAD_STATUS_LABEL, PRIORITIES, CLOSED_STATUSES } from "@/lib/labels";
import { refreshLeadRollups } from "./rollups";
import { notify } from "./notifications";

const optStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const leadInputSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(200),
  contactName: optStr(120),
  jobTitle: optStr(120),
  phone: optStr(40).refine((v) => !v || normalizePhone(v).length >= 7, "Phone number looks incomplete"),
  email: optStr(200).refine((v) => !v || isValidEmail(v), "Email address isn't valid"),
  address: optStr(300),
  city: optStr(100),
  state: optStr(40),
  zip: optStr(20).refine((v) => !v || /^\d{5}(-\d{4})?$/.test(v), "ZIP should be 5 digits (or ZIP+4)"),
  territoryId: optStr(40),
  areaId: optStr(40),
  source: optStr(120),
  industry: optStr(120),
  assignedRepId: optStr(40),
  priority: z.enum(PRIORITIES as [LeadPriority, ...LeadPriority[]]).default("NORMAL"),
  status: z.enum(LEAD_STATUSES as [LeadStatus, ...LeadStatus[]]).default("NEW"),
  estimatedValue: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({ code: "custom", message: "Estimated value must be a positive number" });
        return z.NEVER;
      }
      return Math.round(n * 100) / 100;
    }),
  notes: optStr(10000),
  /** ID of this business in another system (e.g. a prospect # from an exported log). */
  externalId: optStr(60),
  employeeCount: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) {
        ctx.addIssue({ code: "custom", message: "Employees should be a whole number" });
        return z.NEVER;
      }
      return n;
    }),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});
export type LeadInput = z.input<typeof leadInputSchema>;

/** Fields a sales rep may edit on their own assigned leads. */
const REP_EDITABLE = ["contactName", "jobTitle", "phone", "email", "status"] as const;

function derived(d: { businessName: string; phone: string | null; address: string | null; zip: string | null }) {
  return {
    normalizedName: normalizeBusinessName(d.businessName),
    normalizedPhone: normalizePhone(d.phone) || null,
    normalizedAddress: normalizeAddress(d.address, d.zip) || null,
  };
}

async function validateRefs(tx: Tx, d: { territoryId: string | null; areaId: string | null; assignedRepId: string | null }) {
  if (d.areaId) {
    const area = await tx.area.findUnique({ where: { id: d.areaId } });
    if (!area) throw invalid("Selected area doesn't exist.");
    if (d.territoryId && area.territoryId !== d.territoryId) throw invalid("That area belongs to a different territory.");
    d.territoryId = area.territoryId;
  }
  if (d.territoryId && !(await tx.territory.findUnique({ where: { id: d.territoryId } }))) throw invalid("Selected territory doesn't exist.");
  if (d.assignedRepId) {
    const rep = await tx.user.findUnique({ where: { id: d.assignedRepId } });
    if (!rep || rep.role !== "REP" || !rep.active) throw invalid("Leads can only be assigned to an active sales rep.");
  }
}

export async function checkDuplicates(input: { businessName?: string | null; phone?: string | null; address?: string | null; zip?: string | null; email?: string | null }, excludeId?: string) {
  const name = normalizeBusinessName(input.businessName);
  const phone = normalizePhone(input.phone);
  const addr = normalizeAddress(input.address, input.zip);
  const ors: Prisma.LeadWhereInput[] = [];
  if (name) ors.push({ normalizedName: { contains: name.split(" ").slice(0, 2).join(" ") } });
  if (phone.length >= 7) ors.push({ normalizedPhone: phone });
  if (addr) ors.push({ normalizedAddress: { startsWith: addr.split(" ").slice(0, 3).join(" ") } });
  if (input.email) ors.push({ email: { equals: input.email.trim(), mode: "insensitive" } });
  if (!ors.length) return [];
  const pool = await prisma.lead.findMany({
    where: { OR: ors, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, leadNumber: true, businessName: true, normalizedName: true, normalizedPhone: true, normalizedAddress: true, email: true, phone: true, address: true, city: true, archivedAt: true, status: true },
    take: 200,
  });
  const matches = findDuplicates(input, pool);
  return matches.map((m) => ({ ...m, lead: pool.find((p) => p.id === m.id)! }));
}

async function assertExternalIdFree(tx: Tx, externalId: string | null, exceptId?: string) {
  if (!externalId) return;
  const other = await tx.lead.findUnique({ where: { externalId }, select: { id: true, leadNumber: true, businessName: true } });
  if (other && other.id !== exceptId) throw conflict(`Prospect / account # ${externalId} already belongs to lead #${other.leadNumber} ${other.businessName}.`, { duplicates: [other.id] });
}

export async function createLead(
  actor: Actor,
  raw: LeadInput,
  opts: { allowDuplicate?: boolean; isDemo?: boolean; tx?: Tx; source?: string; sourceDetails?: Record<string, string> | null; quiet?: boolean } = {},
) {
  assertCan(actor, "lead.create", "Only the coordinator can add leads.");
  const d = leadInputSchema.parse(raw);
  await assertExternalIdFree(opts.tx ?? prisma, d.externalId);
  if (!opts.allowDuplicate) {
    const dups = await checkDuplicates(d);
    if (dups.length) throw conflict(`This looks like an existing lead: ${dups[0].lead.businessName} (#${dups[0].lead.leadNumber}) — ${dups[0].reasons.join(", ").toLowerCase()}.`, { duplicates: dups.map((x) => x.id) });
  }
  const run = async (tx: Tx) => {
    await validateRefs(tx, d);
    const lead = await tx.lead.create({ data: { ...d, ...derived(d), isDemo: opts.isDemo ?? false, ...(opts.sourceDetails && Object.keys(opts.sourceDetails).length ? { sourceDetails: opts.sourceDetails } : {}) } });
    await audit(tx, actor, "lead.created", { type: "Lead", id: lead.id, leadId: lead.id }, `Lead created${opts.source ? ` (${opts.source})` : ""}: ${lead.businessName}`);
    if (lead.assignedRepId) {
      await tx.leadAssignment.create({ data: { leadId: lead.id, repId: lead.assignedRepId, assignedById: actor.id } });
      await audit(tx, actor, "lead.assigned", { type: "Lead", id: lead.id, leadId: lead.id }, `Assigned to ${(await tx.user.findUnique({ where: { id: lead.assignedRepId } }))?.name}`);
      if (!opts.quiet) await notify(tx, lead.assignedRepId, { type: "LEAD_ASSIGNED", title: `New lead assigned: ${lead.businessName}`, link: `/leads/${lead.id}`, dedupeKey: `assign:${lead.id}:${lead.assignedRepId}:${Date.now()}` });
    }
    return lead;
  };
  return opts.tx ? run(opts.tx) : prisma.$transaction(run);
}

/** Edit a lead. `expectedVersion` guards against overwriting someone else's newer edit. */
export async function updateLead(actor: Actor, id: string, raw: Partial<LeadInput>, expectedVersion?: number) {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw notFound("Lead");
  assertLeadAccess(actor, lead);
  if (expectedVersion !== undefined && expectedVersion !== lead.version) {
    throw conflict("This lead was changed by someone else since you opened it. Reload the page to see the latest version, then make your edit again.");
  }
  let changes: Record<string, unknown>;
  if (isCoordinator(actor)) {
    const merged = leadInputSchema.parse({ ...pickLead(lead), ...raw });
    changes = merged;
  } else {
    const keys = Object.keys(raw).filter((k) => raw[k as keyof LeadInput] !== undefined);
    const disallowed = keys.filter((k) => !(REP_EDITABLE as readonly string[]).includes(k));
    if (disallowed.length) throw forbidden(`Sales reps can't change: ${disallowed.join(", ")}.`);
    const merged = leadInputSchema.parse({ ...pickLead(lead), ...raw });
    changes = Object.fromEntries(REP_EDITABLE.map((k) => [k, merged[k]]));
  }
  return prisma.$transaction(async (tx) => {
    const d = changes as ReturnType<typeof leadInputSchema.parse>;
    if (isCoordinator(actor)) await validateRefs(tx, d);
    if (isCoordinator(actor)) await assertExternalIdFree(tx, d.externalId, id);
    const statusChanged = d.status && d.status !== lead.status;
    const assigneeChanged = isCoordinator(actor) && d.assignedRepId !== lead.assignedRepId;
    const data = { ...changes, ...(isCoordinator(actor) ? derived(d) : {}), ...(changes.phone !== undefined ? { normalizedPhone: normalizePhone(d.phone) || null } : {}) };
    delete (data as Record<string, unknown>).assignedRepId; // assignment goes through assignLeads for history
    const res = await tx.lead.updateMany({ where: { id, version: lead.version }, data: { ...data, version: { increment: 1 } } });
    if (res.count === 0) throw conflict("This lead was just changed by someone else. Reload and try again.");
    const changed = diff(lead as unknown as Record<string, unknown>, data as Record<string, unknown>);
    delete changed.normalizedName;
    delete changed.normalizedPhone;
    delete changed.normalizedAddress;
    if (Object.keys(changed).length) {
      await audit(tx, actor, "lead.updated", { type: "Lead", id, leadId: id }, `Updated ${Object.keys(changed).filter((k) => k !== "status").join(", ") || "status"}`, changed as Prisma.InputJsonValue);
    }
    if (statusChanged) await applyStatusRules(tx, actor, id, lead.status, d.status);
    if (assigneeChanged) await assignInTx(tx, actor, [id], d.assignedRepId);
    return tx.lead.findUniqueOrThrow({ where: { id } });
  });
}

function pickLead(l: Record<string, unknown>): LeadInput {
  const keys = Object.keys(leadInputSchema.shape);
  const o: Record<string, unknown> = {};
  for (const k of keys) {
    const v = l[k];
    o[k] = v && typeof v === "object" && "toNumber" in (v as object) ? (v as { toNumber(): number }).toNumber() : v;
  }
  return o as LeadInput;
}

/**
 * Status change with workflow rules:
 *  - Do Not Contact / Lost / Not a Fit: open follow-ups are canceled and future planned stops removed
 *    (history kept); future appointments are reported so the coordinator can decide.
 */
async function applyStatusRules(tx: Tx, actor: Actor, leadId: string, from: LeadStatus, to: LeadStatus) {
  await audit(tx, actor, "lead.status", { type: "Lead", id: leadId, leadId }, `Status: ${LEAD_STATUS_LABEL[from]} → ${LEAD_STATUS_LABEL[to]}`, { from, to });
  if (to === "DO_NOT_CONTACT" || to === "LOST" || to === "NOT_A_FIT") {
    const fu = await tx.followUp.updateMany({ where: { leadId, status: "OPEN" }, data: { status: "CANCELED", completedAt: new Date() } });
    const stops = await tx.dayPlanStop.deleteMany({ where: { leadId, status: "PLANNED", dayPlan: { date: { gte: new Date().toISOString().slice(0, 10) } } } });
    if (fu.count || stops.count) {
      await audit(tx, actor, "lead.closedCleanup", { type: "Lead", id: leadId, leadId }, `Marked ${LEAD_STATUS_LABEL[to]}: canceled ${fu.count} open follow-up(s), removed ${stops.count} planned visit(s)`);
    }
  }
  await refreshLeadRollups(tx, leadId);
}

/** Change status inside an existing transaction (used by visits, appointments, sales). */
export async function changeLeadStatusInTx(tx: Tx, actor: Actor, leadId: string, to: LeadStatus) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (lead.status === to) return lead.status;
  await tx.lead.update({ where: { id: leadId }, data: { status: to, version: { increment: 1 } } });
  await applyStatusRules(tx, actor, leadId, lead.status, to);
  return to;
}

export async function setLeadStatus(actor: Actor, id: string, status: LeadStatus) {
  return updateLead(actor, id, { status });
}

async function assignInTx(tx: Tx, actor: Actor, ids: string[], repId: string | null) {
  const rep = repId ? await tx.user.findUnique({ where: { id: repId } }) : null;
  if (repId && (!rep || rep.role !== "REP" || !rep.active)) throw invalid("Choose an active sales rep.");
  let changed = 0;
  for (const id of ids) {
    const lead = await tx.lead.findUnique({ where: { id } });
    if (!lead || lead.assignedRepId === repId) continue;
    await tx.leadAssignment.updateMany({ where: { leadId: id, unassignedAt: null }, data: { unassignedAt: new Date() } });
    if (repId) await tx.leadAssignment.create({ data: { leadId: id, repId, assignedById: actor.id } });
    await tx.lead.update({ where: { id }, data: { assignedRepId: repId, version: { increment: 1 } } });
    await audit(tx, actor, "lead.assigned", { type: "Lead", id, leadId: id }, repId ? `Assigned to ${rep!.name}` : "Unassigned");
    changed++;
  }
  if (repId && changed) {
    await notify(tx, repId, {
      type: "LEAD_ASSIGNED",
      title: changed === 1 ? `New lead assigned to you` : `${changed} leads assigned to you`,
      link: changed === 1 ? `/leads/${ids[0]}` : `/leads?view=mine`,
      dedupeKey: `assign:${ids.join(",").slice(0, 120)}:${repId}:${Date.now()}`,
    });
  }
  return changed;
}

export async function assignLeads(actor: Actor, ids: string[], repId: string | null) {
  assertCan(actor, "lead.assign", "Only the coordinator can assign leads.");
  if (!ids.length) throw invalid("Select at least one lead.");
  return prisma.$transaction((tx) => assignInTx(tx, actor, ids, repId));
}

export async function archiveLeads(actor: Actor, ids: string[], archived: boolean) {
  assertCan(actor, "lead.archive", "Only the coordinator can archive leads.");
  return prisma.$transaction(async (tx) => {
    let n = 0;
    for (const id of ids) {
      const l = await tx.lead.findUnique({ where: { id } });
      if (!l || Boolean(l.archivedAt) === archived) continue;
      await tx.lead.update({ where: { id }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
      await audit(tx, actor, archived ? "lead.archived" : "lead.restored", { type: "Lead", id, leadId: id }, archived ? "Archived (history kept)" : "Restored from archive");
      n++;
    }
    return n;
  });
}

export type BulkAction =
  | { kind: "assign"; repId: string | null }
  | { kind: "status"; status: LeadStatus }
  | { kind: "priority"; priority: LeadPriority }
  | { kind: "area"; areaId: string | null }
  | { kind: "tag"; tag: string }
  | { kind: "archive" }
  | { kind: "restore" };

export async function bulkUpdate(actor: Actor, ids: string[], action: BulkAction) {
  assertCan(actor, "lead.bulk", "Only the coordinator can make bulk changes.");
  if (!ids.length) throw invalid("Select at least one lead.");
  if (ids.length > 500) throw invalid("Bulk changes are limited to 500 leads at a time.");
  if (action.kind === "assign") return assignLeads(actor, ids, action.repId);
  if (action.kind === "archive") return archiveLeads(actor, ids, true);
  if (action.kind === "restore") return archiveLeads(actor, ids, false);
  return prisma.$transaction(async (tx) => {
    let n = 0;
    let area: { id: string; territoryId: string } | null = null;
    if (action.kind === "area" && action.areaId) {
      area = await tx.area.findUnique({ where: { id: action.areaId } });
      if (!area) throw invalid("Area not found.");
    }
    for (const id of ids) {
      const l = await tx.lead.findUnique({ where: { id } });
      if (!l) continue;
      if (action.kind === "status") {
        if (l.status === action.status) continue;
        await tx.lead.update({ where: { id }, data: { status: action.status, version: { increment: 1 } } });
        await applyStatusRules(tx, actor, id, l.status, action.status);
      } else if (action.kind === "priority") {
        if (l.priority === action.priority) continue;
        await tx.lead.update({ where: { id }, data: { priority: action.priority, version: { increment: 1 } } });
        await audit(tx, actor, "lead.updated", { type: "Lead", id, leadId: id }, `Priority set to ${action.priority.toLowerCase()} (bulk)`);
      } else if (action.kind === "area") {
        await tx.lead.update({ where: { id }, data: { areaId: area?.id ?? null, territoryId: area?.territoryId ?? l.territoryId, version: { increment: 1 } } });
        await audit(tx, actor, "lead.updated", { type: "Lead", id, leadId: id }, `Area changed (bulk)`);
      } else if (action.kind === "tag") {
        const tag = action.tag.trim().slice(0, 40);
        if (!tag || l.tags.includes(tag)) continue;
        await tx.lead.update({ where: { id }, data: { tags: [...l.tags, tag], version: { increment: 1 } } });
        await audit(tx, actor, "lead.updated", { type: "Lead", id, leadId: id }, `Tag added: ${tag} (bulk)`);
      }
      n++;
    }
    return n;
  });
}

export async function getLeadForActor(actor: Actor, id: string) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { territory: true, area: true, assignedRep: { select: { id: true, name: true } } },
  });
  if (!lead) throw notFound("Lead");
  assertLeadAccess(actor, lead);
  return lead;
}

export function isClosed(s: LeadStatus) {
  return CLOSED_STATUSES.includes(s);
}
