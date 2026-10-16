import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { repScope, type Actor } from "../policy";
import { sp, type SP } from "./leadQuery";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/labels";

export function appointmentWhere(actor: Actor, params: SP, now = new Date()): Prisma.AppointmentWhereInput {
  const and: Prisma.AppointmentWhereInput[] = [repScope(actor)];
  const status = sp(params, "status") ?? "upcoming";
  if (status === "upcoming") and.push({ status: { in: ACTIVE_APPOINTMENT_STATUSES }, endAt: { gte: now } });
  if (status === "past") and.push({ startAt: { lt: now } });
  if (status === "canceled") and.push({ status: "CANCELED" });
  if (status === "completed") and.push({ status: "COMPLETED" });
  if (status === "changed") and.push({ changes: { some: { action: { in: ["MOVED", "CANCELED"] } } } });
  const rep = sp(params, "rep");
  if (rep && actor.role === "COORDINATOR") and.push({ repId: rep });
  const q = sp(params, "q");
  if (q) and.push({ lead: { businessName: { contains: q, mode: "insensitive" } } });
  return { AND: and };
}

export async function listAppointments(actor: Actor, params: SP, take = 300) {
  const status = sp(params, "status") ?? "upcoming";
  return prisma.appointment.findMany({
    where: appointmentWhere(actor, params),
    include: { lead: { select: { id: true, businessName: true, address: true, area: { select: { name: true } } } }, rep: { select: { name: true } }, changes: { where: { action: "MOVED" }, select: { id: true } }, reschedules: { where: { status: "PENDING" }, select: { id: true } } },
    orderBy: { startAt: status === "upcoming" ? "asc" : "desc" },
    take,
  });
}
