import { getActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { listOpportunities } from "@/server/services/salesQuery";
import { prisma } from "@/server/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { OPPORTUNITY_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/labels";
import { fmtDate, resolveRange } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const tz = (await getSettings()).timezone;
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const range = resolveRange(params.range ?? "month", params.from, params.to, tz);
  const rows = await listOpportunities(actor, params, range, 20000);
  await prisma.auditLog.create({ data: { actorId: actor.id, action: "export.sales", entityType: "Opportunity", summary: `Exported ${rows.length} opportunity record(s) to CSV (${range.label})` } });
  const n = (v: unknown) => (v === null || v === undefined ? "" : Number(v).toFixed(2));
  return csvResponse(
    toCsv(rows, [
      { header: "Opportunity ID", value: (o) => `O-${o.oppNumber}` },
      { header: "Business", value: (o) => o.lead.businessName },
      { header: "Area", value: (o) => o.lead.area?.name },
      { header: "Rep", value: (o) => o.rep.name },
      { header: "Product / service", value: (o) => o.product },
      { header: "Status", value: (o) => OPPORTUNITY_STATUS_LABEL[o.status] },
      { header: "Opened", value: (o) => fmtDate(o.openedAt, tz) },
      { header: "Expected close", value: (o) => (o.expectedCloseAt ? fmtDate(o.expectedCloseAt, tz) : "") },
      { header: "Closed", value: (o) => (o.closedAt ? fmtDate(o.closedAt, tz) : "") },
      { header: "Estimated value", value: (o) => n(o.estimatedValue) },
      { header: "Final amount (won only)", value: (o) => (o.status === "WON" ? n(o.finalAmount) : "") },
      { header: "Commission", value: (o) => n(o.commissionAmount) },
      { header: "Payment status", value: (o) => (o.status === "WON" ? PAYMENT_STATUS_LABEL[o.paymentStatus] : "") },
      { header: "Lost reason", value: (o) => o.lostReason },
      { header: "Notes", value: (o) => o.notes },
    ]),
    `sales-${range.startKey}-to-${range.endKey}.csv`,
  );
}
