import type { LeadStatus, VisitOutcome, VisitType } from "@prisma/client";
import { CLOSED_STATUSES, IN_PERSON_TYPES } from "../labels";

export interface VisitLike {
  visitAt: Date;
  type: VisitType;
  outcome: VisitOutcome;
  feedback: string | null;
}

export interface LeadRollups {
  lastVisitAt: Date | null;
  lastContactAt: Date | null;
  lastVisitOutcome: VisitOutcome | null;
  latestFeedback: string | null;
  visitCount: number;
  nextFollowUpAt: Date | null;
  nextAppointmentAt: Date | null;
  nextPlannedVisit: Date | null;
}

/**
 * Lead summary fields derived from the full history. Never overwrites history — it is
 * recomputed from all records, so editing or adding an older visit stays consistent.
 *  - lastVisitAt / visitCount / lastVisitOutcome: in-person visits only (phone calls excluded)
 *  - lastContactAt: any visit record, including phone calls
 *  - latestFeedback: most recent non-empty feedback from any visit record
 */
export function computeRollups(input: {
  visits: VisitLike[];
  openFollowUpDue: Date[];
  activeAppointmentStarts: Date[];
  plannedStopDates: Date[];
  now: Date;
}): LeadRollups {
  const visits = [...input.visits].sort((a, b) => b.visitAt.getTime() - a.visitAt.getTime());
  const inPerson = visits.filter((v) => IN_PERSON_TYPES.includes(v.type));
  const earliest = (ds: Date[], from?: Date) => {
    const xs = ds.filter((d) => !from || d.getTime() >= from.getTime()).sort((a, b) => a.getTime() - b.getTime());
    return xs[0] ?? null;
  };
  return {
    lastVisitAt: inPerson[0]?.visitAt ?? null,
    lastContactAt: visits[0]?.visitAt ?? null,
    lastVisitOutcome: inPerson[0]?.outcome ?? null,
    latestFeedback: visits.find((v) => v.feedback && v.feedback.trim())?.feedback ?? null,
    visitCount: inPerson.length,
    // overdue follow-ups still count as "next" — the earliest open one is what needs doing
    nextFollowUpAt: earliest(input.openFollowUpDue),
    nextAppointmentAt: earliest(input.activeAppointmentStarts, input.now),
    nextPlannedVisit: earliest(input.plannedStopDates, startOfUtcDay(input.now)),
  };
}

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 86_400_000);
}

/** Pipeline order. Automation only moves a lead forward, never backward. */
const RANK: Record<LeadStatus, number> = {
  NEW: 0,
  READY_TO_CONTACT: 1,
  CONTACT_ATTEMPTED: 2,
  APPOINTMENT_REQUESTED: 3,
  VISITED: 4,
  FOLLOW_UP_REQUIRED: 5,
  APPOINTMENT_SCHEDULED: 5,
  INTERESTED: 6,
  OPPORTUNITY_IN_PROGRESS: 7,
  WON: 100,
  LOST: 100,
  NOT_A_FIT: 100,
  DO_NOT_CONTACT: 100,
};

export function statusRank(s: LeadStatus) {
  return RANK[s];
}

/** Move forward to `target` unless the lead is closed or already further along. */
export function advanceStatus(current: LeadStatus, target: LeadStatus): LeadStatus {
  if (CLOSED_STATUSES.includes(current)) return current;
  if (CLOSED_STATUSES.includes(target)) return target;
  return RANK[target] >= RANK[current] ? target : current;
}

/**
 * Suggested lead status after a visit. The rep sees the suggestion on the form and can change it.
 * Closed statuses (Won/Lost/Not a Fit/Do Not Contact) are never changed automatically.
 */
export function suggestStatusAfterVisit(current: LeadStatus, v: { type: VisitType; outcome: VisitOutcome; hasFollowUp: boolean; bookedAppointment: boolean }): LeadStatus {
  if (CLOSED_STATUSES.includes(current)) return current;
  let target: LeadStatus;
  if (v.bookedAppointment || v.outcome === "APPOINTMENT_BOOKED") target = "APPOINTMENT_SCHEDULED";
  else if (v.outcome === "INTERESTED") target = "INTERESTED";
  else if (v.outcome === "BUSINESS_CLOSED") return "NOT_A_FIT";
  else if (v.outcome === "SALE_COMPLETED") target = "OPPORTUNITY_IN_PROGRESS"; // becomes WON when the sale is recorded
  else if (v.hasFollowUp || v.outcome === "REQUESTED_CALLBACK") target = "FOLLOW_UP_REQUIRED";
  else if (v.type === "PHONE_CALL" && (v.outcome === "DECISION_MAKER_UNAVAILABLE" || v.outcome === "NO_ACCESS")) target = "CONTACT_ATTEMPTED";
  else target = v.type === "PHONE_CALL" ? "CONTACT_ATTEMPTED" : "VISITED";
  return advanceStatus(current, target);
}

/** Outcomes where the form should prompt for a follow-up. */
export function outcomeNeedsFollowUp(o: VisitOutcome): boolean {
  return ["REQUESTED_CALLBACK", "INTERESTED", "DECISION_MAKER_UNAVAILABLE", "LEFT_INFORMATION", "SPOKE_WITH_DECISION_MAKER"].includes(o);
}

/** Leads in these statuses must not get new appointments, follow-ups or planned visits. */
export function blocksOutreach(s: LeadStatus): boolean {
  return s === "DO_NOT_CONTACT";
}
