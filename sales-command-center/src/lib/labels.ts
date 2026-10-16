import type {
  AppointmentStatus,
  DayPlanStatus,
  FollowUpStatus,
  InterestLevel,
  LeadPriority,
  LeadStatus,
  OpportunityStatus,
  PaymentStatus,
  RescheduleStatus,
  VisitOutcome,
  VisitType,
} from "@prisma/client";

export type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "info" | "muted";

export const LEAD_STATUSES: LeadStatus[] = [
  "NEW",
  "READY_TO_CONTACT",
  "CONTACT_ATTEMPTED",
  "APPOINTMENT_REQUESTED",
  "APPOINTMENT_SCHEDULED",
  "VISITED",
  "FOLLOW_UP_REQUIRED",
  "INTERESTED",
  "OPPORTUNITY_IN_PROGRESS",
  "WON",
  "LOST",
  "NOT_A_FIT",
  "DO_NOT_CONTACT",
];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: "New",
  READY_TO_CONTACT: "Ready to Contact",
  CONTACT_ATTEMPTED: "Contact Attempted",
  APPOINTMENT_REQUESTED: "Appointment Requested",
  APPOINTMENT_SCHEDULED: "Appointment Scheduled",
  VISITED: "Visited",
  FOLLOW_UP_REQUIRED: "Follow-Up Required",
  INTERESTED: "Interested",
  OPPORTUNITY_IN_PROGRESS: "Opportunity in Progress",
  WON: "Won",
  LOST: "Lost",
  NOT_A_FIT: "Not a Fit",
  DO_NOT_CONTACT: "Do Not Contact",
};

export const LEAD_STATUS_TONE: Record<LeadStatus, Tone> = {
  NEW: "info",
  READY_TO_CONTACT: "info",
  CONTACT_ATTEMPTED: "neutral",
  APPOINTMENT_REQUESTED: "warn",
  APPOINTMENT_SCHEDULED: "accent",
  VISITED: "neutral",
  FOLLOW_UP_REQUIRED: "warn",
  INTERESTED: "good",
  OPPORTUNITY_IN_PROGRESS: "accent",
  WON: "good",
  LOST: "muted",
  NOT_A_FIT: "muted",
  DO_NOT_CONTACT: "bad",
};

/** Statuses that end active selling. History is kept; automation never moves a lead out of these. */
export const CLOSED_STATUSES: LeadStatus[] = ["WON", "LOST", "NOT_A_FIT", "DO_NOT_CONTACT"];

export const PRIORITIES: LeadPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
export const PRIORITY_LABEL: Record<LeadPriority, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };
export const PRIORITY_TONE: Record<LeadPriority, Tone> = { LOW: "muted", NORMAL: "neutral", HIGH: "warn", URGENT: "bad" };
export const PRIORITY_RANK: Record<LeadPriority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };

export const VISIT_TYPES: VisitType[] = ["WALK_IN", "SCHEDULED_APPOINTMENT", "FOLLOW_UP", "PHONE_CALL", "OTHER"];
export const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  WALK_IN: "Walk-in",
  SCHEDULED_APPOINTMENT: "Scheduled appointment",
  FOLLOW_UP: "Follow-up",
  PHONE_CALL: "Phone call",
  OTHER: "Other",
};
/** Phone calls count as contact, not as an in-person visit. */
export const IN_PERSON_TYPES: VisitType[] = ["WALK_IN", "SCHEDULED_APPOINTMENT", "FOLLOW_UP", "OTHER"];

export const VISIT_OUTCOMES: VisitOutcome[] = [
  "DECISION_MAKER_UNAVAILABLE",
  "LEFT_INFORMATION",
  "SPOKE_WITH_DECISION_MAKER",
  "INTERESTED",
  "REQUESTED_CALLBACK",
  "APPOINTMENT_BOOKED",
  "NOT_INTERESTED",
  "NO_ACCESS",
  "BUSINESS_CLOSED",
  "SALE_COMPLETED",
  "OTHER",
];
export const VISIT_OUTCOME_LABEL: Record<VisitOutcome, string> = {
  DECISION_MAKER_UNAVAILABLE: "Decision-maker unavailable",
  LEFT_INFORMATION: "Left information",
  SPOKE_WITH_DECISION_MAKER: "Spoke with decision-maker",
  INTERESTED: "Interested",
  REQUESTED_CALLBACK: "Requested callback",
  APPOINTMENT_BOOKED: "Appointment booked",
  NOT_INTERESTED: "Not interested",
  NO_ACCESS: "No access",
  BUSINESS_CLOSED: "Business closed",
  SALE_COMPLETED: "Sale completed",
  OTHER: "Other",
};
export const VISIT_OUTCOME_TONE: Record<VisitOutcome, Tone> = {
  DECISION_MAKER_UNAVAILABLE: "neutral",
  LEFT_INFORMATION: "neutral",
  SPOKE_WITH_DECISION_MAKER: "info",
  INTERESTED: "good",
  REQUESTED_CALLBACK: "warn",
  APPOINTMENT_BOOKED: "accent",
  NOT_INTERESTED: "muted",
  NO_ACCESS: "muted",
  BUSINESS_CLOSED: "bad",
  SALE_COMPLETED: "good",
  OTHER: "neutral",
};

export const INTEREST_LEVELS: InterestLevel[] = ["NONE", "LOW", "MEDIUM", "HIGH"];
export const INTEREST_LABEL: Record<InterestLevel, string> = { NONE: "None", LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: "Scheduled",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELED: "Canceled",
  NO_SHOW: "No-show",
};
export const APPOINTMENT_STATUS_TONE: Record<AppointmentStatus, Tone> = {
  SCHEDULED: "info",
  CONFIRMED: "accent",
  COMPLETED: "good",
  CANCELED: "muted",
  NO_SHOW: "bad",
};
export const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED"];

export const RESCHEDULE_STATUS_LABEL: Record<RescheduleStatus, string> = { PENDING: "Pending", APPROVED: "Approved", DECLINED: "Declined", CANCELED: "Canceled" };
export const RESCHEDULE_STATUS_TONE: Record<RescheduleStatus, Tone> = { PENDING: "warn", APPROVED: "good", DECLINED: "bad", CANCELED: "muted" };

export const DAY_PLAN_STATUS_LABEL: Record<DayPlanStatus, string> = { PLANNED: "Planned", IN_PROGRESS: "In progress", COMPLETED: "Completed", CHANGED: "Changed" };
export const FOLLOW_UP_STATUS_LABEL: Record<FollowUpStatus, string> = { OPEN: "Open", DONE: "Done", CANCELED: "Canceled" };

export const OPPORTUNITY_STATUSES: OpportunityStatus[] = ["PROSPECTING", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];
export const OPEN_OPPORTUNITY_STATUSES: OpportunityStatus[] = ["PROSPECTING", "QUALIFIED", "PROPOSAL", "NEGOTIATION"];
export const OPPORTUNITY_STATUS_LABEL: Record<OpportunityStatus, string> = {
  PROSPECTING: "Prospecting",
  QUALIFIED: "Qualified",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};
export const OPPORTUNITY_STATUS_TONE: Record<OpportunityStatus, Tone> = {
  PROSPECTING: "neutral",
  QUALIFIED: "info",
  PROPOSAL: "accent",
  NEGOTIATION: "warn",
  WON: "good",
  LOST: "muted",
};

export const PAYMENT_STATUSES: PaymentStatus[] = ["NOT_APPLICABLE", "UNPAID", "PARTIAL", "PAID"];
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = { NOT_APPLICABLE: "N/A", UNPAID: "Unpaid", PARTIAL: "Partially paid", PAID: "Paid" };

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function money(v: number | string | { toString(): string } | null | undefined, opts: { cents?: boolean } = {}): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v.toString());
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: opts.cents ? 2 : n % 1 === 0 ? 0 : 2 });
}

export function pct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(n < 0.1 && n > 0 ? 1 : 0)}%`;
}
