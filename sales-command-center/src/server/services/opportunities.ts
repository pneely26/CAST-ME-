import { z } from "zod";
import type { OpportunityStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit, diff } from "../audit";
import { assertWriter, assertLeadAccess, assertOwnOrCoordinator, isCoordinator, type Actor } from "../policy";
import { conflict, invalid, notFound } from "../errors";
import { changeLeadStatusInTx } from "./leads";
import { notifyCoordinators, notify } from "./notifications";
import { OPPORTUNITY_STATUSES, OPPORTUNITY_STATUS_LABEL, PAYMENT_STATUSES, CLOSED_STATUSES, money } from "@/lib/labels";
import { computeCommission } from "@/lib/domain/sales";
import { advanceStatus } from "@/lib/domain/rollups";
import { fmtDate } from "@/lib/time";
import { getSettings } from "../settings";

const amount = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 100_000_000) {
      ctx.addIssue({ code: "custom", message: "Amounts must be positive numbers" });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });

export const opportunitySchema = z
  .object({
    leadId: z.string().min(10),
    repId: z.string().optional().nullable(),
    product: z.string().trim().min(1, "Product or service is required").max(200),
    status: z.enum(OPPORTUNITY_STATUSES as [OpportunityStatus, ...OpportunityStatus[]]).default("PROSPECTING"),
    openedAt: z.date().optional(),
    expectedCloseAt: z.date().optional().nullable(),
    closedAt: z.date().optional().nullable(),
    estimatedValue: amount,
    finalAmount: amount,
    commissionRatePct: amount, // percent, e.g. 10 = 10% (optional — no assumed rules)
    commissionAmount: amount,
    paymentStatus: z.enum(PAYMENT_STATUSES as [PaymentStatus, ...PaymentStatus[]]).default("NOT_APPLICABLE"),
    notes: z.string().trim().max(10000).optional().nullable(),
    lostReason: z.string().trim().max(1000).optional().nullable(),
    signed44: z.boolean().default(false),
    runDate: z.string().trim().optional().nullable().refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Run date must be a date"),
    goStatus: z.string().trim().max(300, "GO status is too long").optional().nullable(),
    calledToDesk: z.boolean().default(false),
    tentativeRunDate: z.string().trim().optional().nullable().refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Tentative run date must be a date"),
    sourceVisitId: z.string().optional().nullable(),
    /** Explicit confirmation for financially significant changes (closing as won/lost, editing a won amount). */
    confirmed: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.commissionRatePct !== null && v.commissionRatePct !== undefined && v.commissionRatePct > 100) ctx.addIssue({ code: "custom", path: ["commissionRatePct"], message: "Commission rate is a percentage (0–100)" });
  });
export type OpportunityInput = z.input<typeof opportunitySchema>;

function money2(v: unknown) {
  return v === null || v === undefined ? null : Number(v);
}

/** Create or update. Winning a deal sets its close date and final amount and marks the lead Won. */
export async function saveOpportunity(actor: Actor, id: string | null, raw: OpportunityInput, expectedVersion?: number) {
  assertWriter(actor);
  const d = opportunitySchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: d.leadId } });
    if (!lead) throw notFound("Lead");
    assertLeadAccess(actor, lead);
    const before = id ? await tx.opportunity.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound("Opportunity");
    // sales imported from a sales report may have no dollar amount (the report doesn't give one); every other won sale needs it
    if (d.status === "WON" && !d.finalAmount && !before?.externalRef) throw invalid("A won sale needs its final sale amount");
    if (before) {
      assertOwnOrCoordinator(actor, before.repId, "This opportunity belongs to another rep.");
      if (before.leadId !== d.leadId) throw invalid("An opportunity can't be moved to a different lead — create a new one instead.");
      if (expectedVersion !== undefined && expectedVersion !== before.version) throw conflict("This opportunity was changed by someone else. Reload to see the latest version.");
    }
    const closing = d.status === "WON" || d.status === "LOST";
    const wasClosed = before && (before.status === "WON" || before.status === "LOST");
    const wonAmountChanged = before?.status === "WON" && d.status === "WON" && money2(before.finalAmount) !== d.finalAmount;
    const reopening = before?.status === "WON" && d.status !== "WON";
    if ((closing && !wasClosed) || wonAmountChanged || reopening) {
      if (!d.confirmed) throw invalid(reopening ? "Confirm that you want to reopen a won sale — it will be removed from realized revenue." : d.status === "WON" ? `Confirm the sale: ${money(d.finalAmount)} closed ${d.status === "WON" ? "won" : ""}.` : "Confirm closing this opportunity as lost.");
    }
    const repId = isCoordinator(actor) ? (d.repId ?? before?.repId ?? lead.assignedRepId) : actor.id;
    if (!repId) throw invalid("Choose the rep for this opportunity (the lead isn't assigned).");
    const rate = d.commissionRatePct !== null && d.commissionRatePct !== undefined ? d.commissionRatePct / 100 : null;
    const now = new Date();
    const data = {
      leadId: d.leadId,
      repId,
      product: d.product,
      status: d.status,
      openedAt: d.openedAt ?? before?.openedAt ?? now,
      expectedCloseAt: d.expectedCloseAt ?? null,
      closedAt: closing ? (d.closedAt ?? before?.closedAt ?? now) : null,
      estimatedValue: d.estimatedValue,
      finalAmount: d.status === "WON" ? d.finalAmount : d.finalAmount ?? null,
      commissionRate: rate,
      commissionAmount: d.status === "WON" ? computeCommission(d.finalAmount ?? null, rate, d.commissionAmount ?? null) : (d.commissionAmount ?? null),
      paymentStatus: d.paymentStatus,
      notes: d.notes ?? null,
      lostReason: d.status === "LOST" ? (d.lostReason ?? null) : null,
      signed44: d.signed44,
      runDate: d.runDate || null,
      goStatus: d.goStatus || null,
      calledToDesk: d.calledToDesk,
      // a tentative run date only applies while the deal is called to the desk
      tentativeRunDate: d.calledToDesk ? d.tentativeRunDate || null : null,
      sourceVisitId: d.sourceVisitId ?? before?.sourceVisitId ?? null,
    };
    const tz = (await getSettings(tx)).timezone;
    let opp;
    if (before) {
      const res = await tx.opportunity.updateMany({ where: { id: before.id, version: before.version }, data: { ...data, version: { increment: 1 } } });
      if (!res.count) throw conflict("This opportunity was just changed by someone else. Reload and try again.");
      opp = await tx.opportunity.findUniqueOrThrow({ where: { id: before.id } });
      const changed = diff(before as unknown as Record<string, unknown>, data as Record<string, unknown>);
      if (Object.keys(changed).length) await audit(tx, actor, "opportunity.updated", { type: "Opportunity", id: opp.id, leadId: lead.id }, `Opportunity O-${opp.oppNumber} updated (${Object.keys(changed).join(", ")})`, changed as Prisma.InputJsonValue);
    } else {
      opp = await tx.opportunity.create({ data });
      await audit(tx, actor, "opportunity.created", { type: "Opportunity", id: opp.id, leadId: lead.id }, `Opportunity O-${opp.oppNumber} opened: ${d.product}${d.estimatedValue ? ` (est. ${money(d.estimatedValue)})` : ""}`);
    }
    if (before?.status !== opp.status) {
      await audit(tx, actor, "opportunity.status", { type: "Opportunity", id: opp.id, leadId: lead.id }, `Opportunity O-${opp.oppNumber}: ${before ? OPPORTUNITY_STATUS_LABEL[before.status] + " → " : ""}${OPPORTUNITY_STATUS_LABEL[opp.status]}${opp.status === "WON" ? ` — sale of ${money(money2(opp.finalAmount))} on ${fmtDate(opp.closedAt, tz)}` : ""}`);
    }

    // lead status follows the deal (never overrides Do Not Contact)
    if (lead.status !== "DO_NOT_CONTACT") {
      if (opp.status === "WON" && lead.status !== "WON") await changeLeadStatusInTx(tx, actor, lead.id, "WON");
      else if (!["WON", "LOST"].includes(opp.status)) {
        const next = advanceStatus(lead.status, "OPPORTUNITY_IN_PROGRESS");
        if (next !== lead.status && !CLOSED_STATUSES.includes(lead.status)) await changeLeadStatusInTx(tx, actor, lead.id, next);
      }
    }

    if (opp.status === "WON" && before?.status !== "WON") {
      const body = `${lead.businessName}: ${opp.product} — ${money(money2(opp.finalAmount))}`;
      if (isCoordinator(actor)) await notify(tx, repId, { type: "NEW_SALE", title: "Sale recorded", body, link: `/sales/${opp.id}`, dedupeKey: `sale:${opp.id}` });
      else await notifyCoordinators(tx, { type: "NEW_SALE", title: `${actor.name} closed a sale`, body, link: `/sales/${opp.id}`, dedupeKey: `sale:${opp.id}` });
    }
    return opp;
  });
}

export async function archiveOpportunity(actor: Actor, id: string, archived: boolean) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.opportunity.findUnique({ where: { id }, include: { lead: true } });
    if (!o) throw notFound("Opportunity");
    if (!isCoordinator(actor)) throw invalid("Only the coordinator can archive opportunities.");
    await tx.opportunity.update({ where: { id }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
    await audit(tx, actor, archived ? "opportunity.archived" : "opportunity.restored", { type: "Opportunity", id, leadId: o.leadId }, `Opportunity O-${o.oppNumber} ${archived ? "archived (excluded from totals, history kept)" : "restored"}`);
  });
}
