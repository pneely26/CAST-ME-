/**
 * Role-based permission policy. Every service function checks it on the server —
 * hiding a button in the UI is never the only protection.
 */
import type { Prisma, Role } from "@prisma/client";
import { forbidden } from "./errors";

export interface Actor {
  id: string;
  role: Role;
  name: string;
}

export type Permission =
  | "lead.create"
  | "lead.editAll"
  | "lead.archive"
  | "lead.assign"
  | "lead.bulk"
  | "lead.import"
  | "lead.exportAll"
  | "territory.manage"
  | "schedule.manageAll"
  | "appointment.moveDirect"
  | "appointment.cancelAny"
  | "reschedule.resolve"
  | "sales.viewAll"
  | "sales.editAll"
  | "reports.viewAll"
  | "users.manage"
  | "settings.manage"
  | "audit.view"
  | "notifications.broadcast";

const COORDINATOR_ONLY: Permission[] = [
  "lead.create",
  "lead.editAll",
  "lead.archive",
  "lead.assign",
  "lead.bulk",
  "lead.import",
  "lead.exportAll",
  "territory.manage",
  "schedule.manageAll",
  "appointment.moveDirect",
  "appointment.cancelAny",
  "reschedule.resolve",
  "sales.viewAll",
  "sales.editAll",
  "reports.viewAll",
  "users.manage",
  "settings.manage",
  "audit.view",
  "notifications.broadcast",
];

export function can(actor: Actor, p: Permission): boolean {
  if (actor.role === "COORDINATOR") return true;
  return !COORDINATOR_ONLY.includes(p);
}

export function assertCan(actor: Actor, p: Permission, message?: string): void {
  if (!can(actor, p)) throw forbidden(message);
}

export const isCoordinator = (a: Actor) => a.role === "COORDINATOR";

/** Which leads an actor may see. Reps see only leads assigned to them. */
export function leadScope(actor: Actor): Prisma.LeadWhereInput {
  return actor.role === "COORDINATOR" ? {} : { assignedRepId: actor.id };
}

/** Records owned by a rep (visits, appointments, opportunities, follow-ups). */
export function repScope(actor: Actor): { repId?: string } {
  return actor.role === "COORDINATOR" ? {} : { repId: actor.id };
}

export function assertLeadAccess(actor: Actor, lead: { assignedRepId: string | null }): void {
  if (actor.role === "COORDINATOR") return;
  if (lead.assignedRepId !== actor.id) throw forbidden("This lead isn't assigned to you.");
}

/** A rep may act only on their own records; coordinators on any. */
export function assertOwnOrCoordinator(actor: Actor, ownerId: string | null | undefined, message?: string): void {
  if (actor.role === "COORDINATOR") return;
  if (ownerId !== actor.id) throw forbidden(message);
}
