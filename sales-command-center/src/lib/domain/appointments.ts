import type { AppointmentStatus, RescheduleStatus } from "@prisma/client";
import { ACTIVE_APPOINTMENT_STATUSES } from "../labels";

export interface ApptLike {
  id: string;
  leadId: string;
  repId: string;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
  timeSet?: boolean;
}

export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

/** Other active appointments for the same rep whose time overlaps. Appointments without a set time never conflict. */
export function findConflicts(candidate: { id?: string; repId: string; startAt: Date; endAt: Date; timeSet?: boolean }, existing: ApptLike[]): ApptLike[] {
  if (candidate.timeSet === false) return [];
  return existing.filter(
    (e) => e.id !== candidate.id && e.repId === candidate.repId && e.timeSet !== false && ACTIVE_APPOINTMENT_STATUSES.includes(e.status) && overlaps(candidate.startAt, candidate.endAt, e.startAt, e.endAt),
  );
}

/**
 * An active appointment for the same lead starting within `windowMinutes` is treated as the
 * same scheduling event (accidental double booking / double submit).
 */
export function findDuplicate(candidate: { id?: string; leadId: string; startAt: Date }, existing: ApptLike[], windowMinutes: number): ApptLike | null {
  return (
    existing.find(
      (e) =>
        e.id !== candidate.id &&
        e.leadId === candidate.leadId &&
        ACTIVE_APPOINTMENT_STATUSES.includes(e.status) &&
        Math.abs(e.startAt.getTime() - candidate.startAt.getTime()) < windowMinutes * 60_000,
    ) ?? null
  );
}

export function validateTimes(startAt: Date, endAt: Date): string | null {
  if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) return "Start and end times are required.";
  if (endAt <= startAt) return "End time must be after the start time.";
  if (endAt.getTime() - startAt.getTime() > 12 * 3_600_000) return "An appointment can't be longer than 12 hours.";
  return null;
}

type RescheduleAction = "approve" | "decline" | "cancel" | "edit";

/** Reschedule request state machine: only PENDING requests can change. */
export function canResolve(status: RescheduleStatus, action: RescheduleAction): boolean {
  return status === "PENDING" && ["approve", "decline", "cancel", "edit"].includes(action);
}

export function appointmentIsActive(s: AppointmentStatus) {
  return ACTIVE_APPOINTMENT_STATUSES.includes(s);
}
