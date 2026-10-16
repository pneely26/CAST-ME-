"use client";

import { useMemo, useState } from "react";
import type { LeadStatus, VisitOutcome, VisitType } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { recordVisitAction } from "@/app/actions/visits";
import { INTEREST_LABEL, INTEREST_LEVELS, LEAD_STATUSES, LEAD_STATUS_LABEL, VISIT_OUTCOMES, VISIT_OUTCOME_LABEL, VISIT_TYPES, VISIT_TYPE_LABEL } from "@/lib/labels";
import { outcomeNeedsFollowUp, suggestStatusAfterVisit } from "@/lib/domain/rollups";
import { addDays } from "@/lib/time";
import clsx from "clsx";

interface Props {
  leadId: string;
  currentStatus: LeadStatus;
  today: string;
  nowTime: string;
  returnTo: string;
  appointmentId?: string | null;
  defaultType?: VisitType;
  reps?: { id: string; name: string }[];
  defaultRepId?: string | null;
  contactName?: string | null;
}

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={clsx("rounded-lg border px-3 py-2.5 text-left text-sm transition-colors", selected ? "border-accent bg-accent text-white" : "border-line bg-white text-ink hover:bg-canvas")}>
      {children}
    </button>
  );
}

export function VisitForm(p: Props) {
  const [type, setType] = useState<VisitType>(p.defaultType ?? "WALK_IN");
  const [outcome, setOutcome] = useState<VisitOutcome | "">("");
  const [interest, setInterest] = useState<string>("");
  const [wantFollowUp, setWantFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(addDays(p.today, 2));
  const [wantAppt, setWantAppt] = useState(false);
  const [statusTouched, setStatusTouched] = useState(false);
  const [status, setStatus] = useState<LeadStatus>(p.currentStatus);
  const [more, setMore] = useState(false);
  const clientKey = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random())), []);

  const suggested = outcome ? suggestStatusAfterVisit(p.currentStatus, { type, outcome, hasFollowUp: wantFollowUp, bookedAppointment: wantAppt }) : p.currentStatus;
  const shownStatus = statusTouched ? status : suggested;

  const pickOutcome = (o: VisitOutcome) => {
    setOutcome(o);
    if (outcomeNeedsFollowUp(o)) setWantFollowUp(true);
    if (o === "APPOINTMENT_BOOKED") setWantAppt(true);
  };

  return (
    <ActionForm action={recordVisitAction} className="space-y-5">
      <input type="hidden" name="leadId" value={p.leadId} />
      <input type="hidden" name="clientKey" value={clientKey} />
      <input type="hidden" name="returnTo" value={p.returnTo} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="outcome" value={outcome} />
      <input type="hidden" name="interestLevel" value={interest} />
      <input type="hidden" name="wantFollowUp" value={wantFollowUp ? "on" : ""} />
      <input type="hidden" name="wantAppointment" value={wantAppt ? "on" : ""} />
      <input type="hidden" name="newStatus" value={shownStatus} />
      {p.appointmentId && <input type="hidden" name="appointmentId" value={p.appointmentId} />}

      <fieldset>
        <legend className="label">Type</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {VISIT_TYPES.map((t) => <Pill key={t} selected={type === t} onClick={() => setType(t)}>{VISIT_TYPE_LABEL[t]}</Pill>)}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Outcome <span className="text-red-600">*</span></legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {VISIT_OUTCOMES.map((o) => <Pill key={o} selected={outcome === o} onClick={() => pickOutcome(o)}>{VISIT_OUTCOME_LABEL[o]}</Pill>)}
        </div>
      </fieldset>

      <label className="block">
        <span className="label">Feedback</span>
        <textarea name="feedback" rows={4} className="input text-base sm:text-sm" placeholder="What happened? What did they say?" />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Spoke with</span><input name="contactEncountered" className="input" defaultValue={p.contactName ?? ""} placeholder="Name / role" /></label>
        <fieldset>
          <legend className="label">Interest level</legend>
          <div className="grid grid-cols-4 gap-1">
            {INTEREST_LEVELS.map((i) => <Pill key={i} selected={interest === i} onClick={() => setInterest(interest === i ? "" : i)}>{INTEREST_LABEL[i]}</Pill>)}
          </div>
        </fieldset>
      </div>

      <div className="card p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-5 w-5" checked={wantFollowUp} onChange={(e) => setWantFollowUp(e.target.checked)} /> Set a follow-up
        </label>
        {wantFollowUp && (
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="block"><span className="label">Follow-up action</span><input name="followUpAction" className="input" placeholder="e.g. Call back Thursday with pricing" required /></label>
            <div>
              <span className="label">Due</span>
              <div className="flex flex-wrap gap-1">
                {[["Tomorrow", 1], ["3 days", 3], ["1 week", 7], ["2 weeks", 14]].map(([l, n]) => (
                  <button key={l} type="button" onClick={() => setFollowUpDate(addDays(p.today, n as number))} className={clsx("btn-secondary btn-sm", followUpDate === addDays(p.today, n as number) && "border-accent text-accent")}>{l}</button>
                ))}
              </div>
              <div className="mt-1 flex gap-1">
                <input type="date" name="followUpDate" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="input" required />
                <input type="time" name="followUpTime" defaultValue="09:00" className="input w-28" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-5 w-5" checked={wantAppt} onChange={(e) => setWantAppt(e.target.checked)} /> Book the next appointment
        </label>
        {wantAppt && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block"><span className="label">Date</span><input type="date" name="apptDate" min={p.today} defaultValue={addDays(p.today, 3)} className="input" required /></label>
            <label className="block"><span className="label">Time</span><input type="time" name="apptTime" defaultValue="10:00" className="input" required /></label>
            <label className="block"><span className="label">Length</span>
              <select name="apptMinutes" defaultValue="45" className="input">{[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}</select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs"><input type="checkbox" name="allowOverlap" /> Book even if it overlaps</label>
          </div>
        )}
      </div>

      <label className="block">
        <span className="label">Lead status after this visit</span>
        <select className="input" value={shownStatus} onChange={(e) => { setStatusTouched(true); setStatus(e.target.value as LeadStatus); }}>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}{s === suggested && !statusTouched && outcome ? " (suggested)" : ""}</option>)}
        </select>
      </label>

      <button type="button" className="text-sm text-accent" onClick={() => setMore((m) => !m)} aria-expanded={more}>{more ? "Hide" : "More"}: objections, notes, attachment, time</button>
      {more && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2"><span className="label">Objections / reasons for not moving forward</span><textarea name="objections" rows={2} className="input" /></label>
          <label className="block sm:col-span-2"><span className="label">Notes</span><textarea name="notes" rows={2} className="input" /></label>
          <label className="block"><span className="label">Visit date</span><input type="date" name="visitDate" defaultValue={p.today} max={p.today} className="input" /></label>
          <label className="block"><span className="label">Visit time</span><input type="time" name="visitTime" defaultValue={p.nowTime} className="input" /></label>
          {p.reps && (
            <label className="block"><span className="label">Rep who made the visit</span>
              <select name="repId" defaultValue={p.defaultRepId ?? ""} className="input"><option value="">Lead's assigned rep</option>{p.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            </label>
          )}
          <label className="block"><span className="label">Attachment (photo or PDF, max 10 MB)</span><input type="file" name="attachment" accept="image/*,application/pdf" className="block w-full text-sm" /></label>
        </div>
      )}
      {!more && <><input type="hidden" name="visitDate" value={p.today} /><input type="hidden" name="visitTime" value={p.nowTime} /></>}

      <div className="sticky bottom-16 z-10 -mx-4 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
        <SubmitButton className="btn-primary w-full py-3 text-base sm:w-auto sm:py-2 sm:text-sm" disabled={!outcome}>{outcome === "SALE_COMPLETED" ? "Save visit & record sale" : "Save visit"}</SubmitButton>
        {!outcome && <p className="mt-1 text-xs text-muted">Pick an outcome to save.</p>}
      </div>
    </ActionForm>
  );
}
