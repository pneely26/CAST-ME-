import { z } from "zod";
import { prisma, type Tx } from "../db";
import { audit } from "../audit";
import { assertLeadAccess, assertOwnOrCoordinator, isCoordinator, type Actor } from "../policy";
import { invalid, notFound } from "../errors";
import { refreshLeadRollups } from "./rollups";
import { notify } from "./notifications";
import { blocksOutreach } from "@/lib/domain/rollups";
import { fmtDate } from "@/lib/time";
import { getSettings } from "../settings";

export const followUpSchema = z.object({
  leadId: z.string().min(10),
  dueAt: z.date({ error: "Follow-up due date is required" }),
  action: z.string().trim().min(1, "Describe the follow-up").max(500),
  assignedToId: z.string().optional().nullable(),
  sourceVisitId: z.string().optional().nullable(),
});

export async function createFollowUpInTx(tx: Tx, actor: Actor, raw: z.input<typeof followUpSchema>) {
  const d = followUpSchema.parse(raw);
  const lead = await tx.lead.findUnique({ where: { id: d.leadId } });
  if (!lead) throw notFound("Lead");
  assertLeadAccess(actor, lead);
  if (blocksOutreach(lead.status)) throw invalid("This lead is marked Do Not Contact — follow-ups can't be scheduled.");
  // reps can only assign follow-ups to themselves; coordinators to the lead's rep (default) or themselves
  let assignee = d.assignedToId ?? lead.assignedRepId ?? actor.id;
  if (!isCoordinator(actor)) assignee = actor.id;
  const fu = await tx.followUp.create({
    data: { leadId: d.leadId, dueAt: d.dueAt, action: d.action, assignedToId: assignee, createdById: actor.id, sourceVisitId: d.sourceVisitId ?? null },
  });
  const tz = (await getSettings(tx)).timezone;
  await audit(tx, actor, "followup.created", { type: "FollowUp", id: fu.id, leadId: d.leadId }, `Follow-up due ${fmtDate(d.dueAt, tz)}: ${d.action}`);
  if (assignee !== actor.id) {
    await notify(tx, assignee, { type: "FOLLOW_UP_DUE", title: `New follow-up: ${lead.businessName}`, body: `${d.action} — due ${fmtDate(d.dueAt, tz)}`, link: `/follow-ups`, dedupeKey: `fu-created:${fu.id}` });
  }
  await refreshLeadRollups(tx, d.leadId);
  return fu;
}

export async function createFollowUp(actor: Actor, raw: z.input<typeof followUpSchema>) {
  return prisma.$transaction((tx) => createFollowUpInTx(tx, actor, raw));
}

export async function setFollowUpStatus(actor: Actor, id: string, status: "DONE" | "CANCELED" | "OPEN", note?: string) {
  return prisma.$transaction(async (tx) => {
    const fu = await tx.followUp.findUnique({ where: { id }, include: { lead: true } });
    if (!fu) throw notFound("Follow-up");
    assertLeadAccess(actor, fu.lead);
    assertOwnOrCoordinator(actor, fu.assignedToId, "This follow-up is assigned to someone else.");
    await tx.followUp.update({ where: { id }, data: { status, completedAt: status === "OPEN" ? null : new Date() } });
    await audit(tx, actor, `followup.${status.toLowerCase()}`, { type: "FollowUp", id, leadId: fu.leadId }, `Follow-up ${status === "DONE" ? "completed" : status === "CANCELED" ? "canceled" : "reopened"}: ${fu.action}${note ? ` — ${note}` : ""}`);
    await refreshLeadRollups(tx, fu.leadId);
  });
}

export async function rescheduleFollowUp(actor: Actor, id: string, dueAt: Date) {
  if (isNaN(dueAt.getTime())) throw invalid("Choose a valid date.");
  return prisma.$transaction(async (tx) => {
    const fu = await tx.followUp.findUnique({ where: { id }, include: { lead: true } });
    if (!fu) throw notFound("Follow-up");
    assertLeadAccess(actor, fu.lead);
    assertOwnOrCoordinator(actor, fu.assignedToId);
    const tz = (await getSettings(tx)).timezone;
    await tx.followUp.update({ where: { id }, data: { dueAt } });
    await audit(tx, actor, "followup.moved", { type: "FollowUp", id, leadId: fu.leadId }, `Follow-up moved from ${fmtDate(fu.dueAt, tz)} to ${fmtDate(dueAt, tz)}`);
    await refreshLeadRollups(tx, fu.leadId);
  });
}
