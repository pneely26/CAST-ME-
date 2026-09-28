export type DeadlineState = "NONE" | "PASSED" | "TODAY" | "SOON" | "UPCOMING";

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole calendar days from `now` to `deadline` (negative when passed). */
export function daysUntil(deadline: Date, now: Date = new Date()): number {
  return Math.round((startOfDay(deadline) - startOfDay(now)) / DAY);
}

export function deadlineState(deadline: Date | null | undefined, now: Date = new Date(), soonDays = 3): DeadlineState {
  if (!deadline) return "NONE";
  if (deadline.getTime() < now.getTime() && daysUntil(deadline, now) < 0) return "PASSED";
  const d = daysUntil(deadline, now);
  if (d < 0) return "PASSED";
  if (d === 0) return deadline.getTime() < now.getTime() ? "PASSED" : "TODAY";
  if (d <= soonDays) return "SOON";
  return "UPCOMING";
}

export function deadlineLabel(deadline: Date | null | undefined, now: Date = new Date()): string {
  if (!deadline) return "No deadline listed";
  const d = daysUntil(deadline, now);
  if (d < 0) return `Passed ${-d} day${d === -1 ? "" : "s"} ago`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}

export function sortByDeadline<T>(items: T[], get: (t: T) => Date | null | undefined): T[] {
  return [...items].sort((a, b) => {
    const da = get(a);
    const db = get(b);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.getTime() - db.getTime();
  });
}

export type SourceState = "CURRENT" | "UNVERIFIED" | "STALE" | "CASTING_CLOSED";

export interface SourceStateInput {
  verifiedAt?: Date | null;
  visibility?: string | null;
  projectStatus?: string | null;
  submissionDeadline?: Date | null;
}

/**
 * Freshness of an externally-sourced record. Old information is never presented as current:
 * closed casting beats everything, then missing verification, then age of verification.
 */
export function sourceState(input: SourceStateInput, now: Date = new Date(), staleAfterDays = 14): SourceState {
  if (input.visibility === "CLOSED" || input.projectStatus === "CASTING_CLOSED") return "CASTING_CLOSED";
  if (input.submissionDeadline && deadlineState(input.submissionDeadline, now) === "PASSED") return "CASTING_CLOSED";
  if (!input.verifiedAt) return "UNVERIFIED";
  if (now.getTime() - input.verifiedAt.getTime() > staleAfterDays * DAY) return "STALE";
  return "CURRENT";
}

export const SOURCE_STATE_LABEL: Record<SourceState, string> = {
  CURRENT: "VERIFIED",
  UNVERIFIED: "UNVERIFIED",
  STALE: "STALE",
  CASTING_CLOSED: "CASTING CLOSED",
};
