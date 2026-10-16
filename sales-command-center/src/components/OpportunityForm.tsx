"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "./ActionForm";
import { saveOpportunityAction } from "@/app/actions/sales";
import { OPPORTUNITY_STATUSES, OPPORTUNITY_STATUS_LABEL, PAYMENT_STATUSES, PAYMENT_STATUS_LABEL } from "@/lib/labels";

export interface OppDefaults {
  id?: string;
  version?: number;
  leadId?: string;
  repId?: string | null;
  product?: string;
  status?: string;
  openedAt?: string;
  expectedCloseAt?: string;
  closedAt?: string;
  estimatedValue?: string;
  finalAmount?: string;
  commissionRatePct?: string;
  commissionAmount?: string;
  paymentStatus?: string;
  notes?: string;
  lostReason?: string;
  signed44?: boolean;
  runDate?: string;
  goStatus?: string;
  sourceVisitId?: string | null;
}

export function OpportunityForm({ d, leads, reps, today }: { d: OppDefaults; leads?: { id: string; label: string }[]; reps?: { id: string; name: string }[]; today: string }) {
  const [status, setStatus] = useState(d.status ?? "PROSPECTING");
  const wasWon = d.status === "WON";
  const won = status === "WON";
  const lost = status === "LOST";
  return (
    <ActionForm action={saveOpportunityAction} className="card grid gap-3 p-4 sm:grid-cols-2">
      {d.id && <input type="hidden" name="id" value={d.id} />}
      {d.version !== undefined && <input type="hidden" name="version" value={d.version} />}
      {d.sourceVisitId && <input type="hidden" name="sourceVisitId" value={d.sourceVisitId} />}
      {leads ? (
        <label className="block sm:col-span-2"><span className="label">Business <span className="text-red-600">*</span></span>
          <select name="leadId" required defaultValue={d.leadId ?? ""} className="input"><option value="" disabled>Choose a lead…</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
        </label>
      ) : (
        <input type="hidden" name="leadId" value={d.leadId} />
      )}
      <label className="block"><span className="label">Product / service <span className="text-red-600">*</span></span><input name="product" required maxLength={200} defaultValue={d.product} className="input" /></label>
      <label className="block"><span className="label">Status</span>
        <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="input">{OPPORTUNITY_STATUSES.map((s) => <option key={s} value={s}>{OPPORTUNITY_STATUS_LABEL[s]}</option>)}</select>
      </label>
      {reps && (
        <label className="block"><span className="label">Rep</span>
          <select name="repId" defaultValue={d.repId ?? ""} className="input"><option value="">Lead's assigned rep</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        </label>
      )}
      <label className="block"><span className="label">Estimated deal value ($)</span><input name="estimatedValue" inputMode="decimal" defaultValue={d.estimatedValue} className="input" /></label>
      <label className="block"><span className="label">Date opened</span><input type="date" name="openedAt" defaultValue={d.openedAt ?? today} className="input" /></label>
      <label className="block"><span className="label">Expected close</span><input type="date" name="expectedCloseAt" defaultValue={d.expectedCloseAt} className="input" /></label>

      {(won || lost) && (
        <label className="block"><span className="label">Actual close date</span><input type="date" name="closedAt" defaultValue={d.closedAt ?? today} className="input" /></label>
      )}
      {won && (
        <>
          <label className="block"><span className="label">Final sale amount ($) <span className="text-red-600">*</span></span><input name="finalAmount" inputMode="decimal" required defaultValue={d.finalAmount ?? d.estimatedValue} className="input" /></label>
          <label className="block"><span className="label">Payment status</span>
            <select name="paymentStatus" defaultValue={d.paymentStatus ?? "UNPAID"} className="input">{PAYMENT_STATUSES.map((p) => <option key={p} value={p}>{PAYMENT_STATUS_LABEL[p]}</option>)}</select>
          </label>
          <fieldset className="grid grid-cols-2 gap-2 sm:col-span-2">
            <legend className="label">Commission (optional — no rules assumed)</legend>
            <label className="block"><span className="text-xs text-muted">Rate (%)</span><input name="commissionRatePct" inputMode="decimal" defaultValue={d.commissionRatePct} className="input" /></label>
            <label className="block"><span className="text-xs text-muted">or fixed amount ($)</span><input name="commissionAmount" inputMode="decimal" defaultValue={d.commissionAmount} className="input" /></label>
          </fieldset>
        </>
      )}
      <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:col-span-2 sm:grid-cols-3">
        <legend className="label px-1">Sale tracking</legend>
        <label className="flex items-center gap-2 text-sm sm:pt-6"><input type="checkbox" name="signed44" defaultChecked={d.signed44} className="h-5 w-5" /> Signed 44</label>
        <label className="block"><span className="label">Run date</span><input type="date" name="runDate" defaultValue={d.runDate} className="input" /><span className="mt-0.5 block text-xs text-muted">When the sold job actually runs</span></label>
        <label className="block"><span className="label">GO status</span><input name="goStatus" maxLength={300} defaultValue={d.goStatus} className="input" /></label>
      </fieldset>
      {lost && <label className="block sm:col-span-2"><span className="label">Reason lost</span><input name="lostReason" maxLength={1000} defaultValue={d.lostReason} className="input" /></label>}
      <label className="block sm:col-span-2"><span className="label">Notes</span><textarea name="notes" rows={3} defaultValue={d.notes} className="input" /></label>
      {(won || lost || wasWon) && (
        <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm sm:col-span-2">
          <input type="checkbox" name="confirmed" className="mt-0.5 h-4 w-4" required={won || lost || wasWon} />
          <span>{won ? "I confirm this sale closed and the final amount is correct. It will count toward realized revenue." : lost ? "I confirm this opportunity is lost." : "I confirm reopening this won sale — it will no longer count toward realized revenue."}</span>
        </label>
      )}
      <div className="sm:col-span-2"><SubmitButton>{d.id ? "Save changes" : won ? "Record sale" : "Create opportunity"}</SubmitButton></div>
    </ActionForm>
  );
}
