import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { assertLeadAccess, assertOwnOrCoordinator, isCoordinator } from "@/server/policy";
import { repOptions } from "@/server/options";
import { Badge, Flash, KV, PageHeader, Section } from "@/components/ui";
import { OppStatusBadge } from "@/components/badges";
import { OpportunityForm } from "@/components/OpportunityForm";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { archiveOpportunityAction } from "@/app/actions/sales";
import { PAYMENT_STATUS_LABEL, money } from "@/lib/labels";
import { dateKeyInTz, fmtDate, fmtDateTime, fmtDateKey } from "@/lib/time";
import { WriteOnly } from "@/components/ReadOnly";

export const metadata = { title: "Opportunity" };

export default async function OppPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; edit?: string }> }) {
  const { id } = await params;
  const { msg, edit: editParam } = await searchParams;
  const actor = await requireActor();
  const edit = editParam && actor.role === "COORDINATOR" ? editParam : undefined; // reps are view-only
  const tz = (await getSettings()).timezone;
  const o = await prisma.opportunity.findUnique({ where: { id }, include: { lead: true, rep: { select: { name: true } }, sourceVisit: { select: { id: true, visitAt: true } } } });
  if (!o) notFound();
  try {
    assertLeadAccess(actor, o.lead);
    assertOwnOrCoordinator(actor, o.repId);
  } catch {
    notFound();
  }
  const history = await prisma.auditLog.findMany({ where: { entityType: "Opportunity", entityId: o.id }, orderBy: { createdAt: "desc" }, include: { actor: { select: { name: true } } } });
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const key = (d: Date | null) => (d ? dateKeyInTz(d, tz) : undefined);
  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: "/sales", label: "Sales" }}
        title={`O-${o.oppNumber} · ${o.product}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><OppStatusBadge s={o.status} />{o.archivedAt && <Badge tone="muted">Archived</Badge>}<Link className="link" href={`/leads/${o.leadId}?tab=sales`}>{o.lead.businessName}</Link> · {o.rep.name}</span>}
        actions={!edit ? <WriteOnly><Link href={`/sales/${o.id}?edit=1`} className="btn-primary">Edit</Link></WriteOnly> : undefined}
      />
      <Flash message={msg} />
      {edit ? (
        <OpportunityForm
          today={dateKeyInTz(new Date(), tz)}
          reps={isCoordinator(actor) ? await repOptions() : undefined}
          d={{
            id: o.id, version: o.version, leadId: o.leadId, repId: o.repId, product: o.product, status: o.status,
            openedAt: key(o.openedAt), expectedCloseAt: key(o.expectedCloseAt), closedAt: key(o.closedAt),
            estimatedValue: o.estimatedValue?.toString(), finalAmount: o.finalAmount?.toString(),
            commissionRatePct: o.commissionRate ? (Number(o.commissionRate) * 100).toString() : undefined, commissionAmount: o.commissionAmount?.toString(),
            paymentStatus: o.paymentStatus, notes: o.notes ?? undefined, lostReason: o.lostReason ?? undefined, sourceVisitId: o.sourceVisitId, signed44: o.signed44, runDate: o.runDate ?? undefined, goStatus: o.goStatus ?? undefined, calledToDesk: o.calledToDesk, tentativeRunDate: o.tentativeRunDate ?? undefined,
          }}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Section title="Details" className="lg:col-span-2">
            <dl className="grid gap-4 p-4 sm:grid-cols-3">
              <KV label="Estimated value">{money(n(o.estimatedValue))}</KV>
              <KV label="Final sale amount">{o.status === "WON" ? money(n(o.finalAmount), { cents: true }) : "—"}</KV>
              <KV label="Payment">{o.status === "WON" ? PAYMENT_STATUS_LABEL[o.paymentStatus] : "—"}</KV>
              <KV label="Opened">{fmtDate(o.openedAt, tz)}</KV>
              <KV label="Expected close">{fmtDate(o.expectedCloseAt, tz)}</KV>
              <KV label="Actual close">{fmtDate(o.closedAt, tz)}</KV>
              <KV label="Signed 44">{o.signed44 ? "Yes" : "No"}</KV>
              <KV label="Run date">{o.runDate ? fmtDateKey(o.runDate) : "—"}</KV>
              <KV label="GO status">{o.goStatus || "—"}</KV>
              <KV label="Called to desk">{o.calledToDesk ? "Yes" : "No"}</KV>
              {o.calledToDesk && <KV label="Tentative run date">{o.tentativeRunDate ? fmtDateKey(o.tentativeRunDate) : "Not set"}</KV>}
              <KV label="Commission">{o.commissionAmount ? money(n(o.commissionAmount), { cents: true }) : o.commissionRate ? `${(Number(o.commissionRate) * 100).toFixed(2)}%` : "Not set"}</KV>
              <KV label="Source visit">{o.sourceVisit ? <Link className="link" href={`/leads/${o.leadId}?tab=visits`}>{fmtDate(o.sourceVisit.visitAt, tz)}</Link> : "—"}</KV>
              {o.lostReason && <KV label="Reason lost">{o.lostReason}</KV>}
              {o.notes && <KV label="Notes" className="sm:col-span-3"><span className="whitespace-pre-line">{o.notes}</span></KV>}
              <KV label="Created">{fmtDateTime(o.createdAt, tz)}</KV>
              <KV label="Updated">{fmtDateTime(o.updatedAt, tz)}</KV>
            </dl>
          </Section>
          <div className="space-y-5">
            <Section title="History">
              <ul className="divide-y divide-line-2">
                {history.map((h) => <li key={h.id} className="px-4 py-2 text-sm">{h.summary}<div className="text-xs text-muted">{fmtDateTime(h.createdAt, tz)} · {h.actor?.name ?? "system"}</div></li>)}
              </ul>
            </Section>
            {isCoordinator(actor) && (
              <ActionForm action={archiveOpportunityAction} confirm={o.archivedAt ? undefined : "Archive this opportunity? It will be excluded from sales totals but its history is kept."}>
                <input type="hidden" name="id" value={o.id} /><input type="hidden" name="archive" value={o.archivedAt ? "false" : "true"} />
                <SubmitButton className={o.archivedAt ? "btn-secondary w-full" : "btn-danger w-full"}>{o.archivedAt ? "Restore" : "Archive"}</SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
