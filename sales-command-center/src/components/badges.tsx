import type { AppointmentStatus, LeadPriority, LeadStatus, OpportunityStatus, RescheduleStatus, VisitOutcome } from "@prisma/client";
import { Badge } from "./ui";
import {
  APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_TONE, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, OPPORTUNITY_STATUS_LABEL, OPPORTUNITY_STATUS_TONE,
  PRIORITY_LABEL, PRIORITY_TONE, RESCHEDULE_STATUS_LABEL, RESCHEDULE_STATUS_TONE, VISIT_OUTCOME_LABEL, VISIT_OUTCOME_TONE,
} from "@/lib/labels";

export const LeadStatusBadge = ({ s }: { s: LeadStatus }) => <Badge tone={LEAD_STATUS_TONE[s]}>{LEAD_STATUS_LABEL[s]}</Badge>;
export const PriorityBadge = ({ p, quietNormal }: { p: LeadPriority; quietNormal?: boolean }) =>
  quietNormal && p === "NORMAL" ? null : <Badge tone={PRIORITY_TONE[p]}>{PRIORITY_LABEL[p]} priority</Badge>;
export const OutcomeBadge = ({ o }: { o: VisitOutcome }) => <Badge tone={VISIT_OUTCOME_TONE[o]}>{VISIT_OUTCOME_LABEL[o]}</Badge>;
export const ApptStatusBadge = ({ s }: { s: AppointmentStatus }) => <Badge tone={APPOINTMENT_STATUS_TONE[s]}>{APPOINTMENT_STATUS_LABEL[s]}</Badge>;
export const OppStatusBadge = ({ s }: { s: OpportunityStatus }) => <Badge tone={OPPORTUNITY_STATUS_TONE[s]}>{OPPORTUNITY_STATUS_LABEL[s]}</Badge>;
export const RescheduleBadge = ({ s }: { s: RescheduleStatus }) => <Badge tone={RESCHEDULE_STATUS_TONE[s]}>{RESCHEDULE_STATUS_LABEL[s]}</Badge>;

/** Due-date badge: overdue / today / upcoming / done, always with words. */
export function DueBadge({ due, now, tz, done }: { due: Date | null; now: Date; tz: string; done?: boolean }) {
  if (!due) return null;
  if (done) return <Badge tone="good">Done</Badge>;
  const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const t = dayOf(now);
  const d = dayOf(due);
  if (d < t) return <Badge tone="bad">Overdue</Badge>;
  if (d === t) return <Badge tone="warn">Due today</Badge>;
  return <Badge tone="info">Upcoming</Badge>;
}
