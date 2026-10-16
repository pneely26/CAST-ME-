import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { assertCan, type Actor } from "../policy";
import { conflict, invalid, notFound } from "../errors";
import { isValidEmail } from "@/lib/normalize";

const password = z.string().min(10, "Passwords need at least 10 characters").max(200);
const userSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().max(200).refine(isValidEmail, "Email address isn't valid"),
  role: z.enum(["COORDINATOR", "REP"]),
  phone: z.string().trim().max(40).optional().nullable(),
});

const hash = (pw: string) => bcrypt.hashSync(pw, 12);

async function activeCoordinatorCount(excludeId?: string) {
  return prisma.user.count({ where: { role: "COORDINATOR", active: true, ...(excludeId ? { id: { not: excludeId } } : {}) } });
}

export async function listUsers(actor: Actor) {
  assertCan(actor, "users.manage", "Only the coordinator can manage users.");
  const users = await prisma.user.findMany({ orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }], select: { id: true, name: true, email: true, role: true, phone: true, active: true, createdAt: true } });
  const leadCounts = await prisma.lead.groupBy({ by: ["assignedRepId"], where: { archivedAt: null, assignedRepId: { in: users.map((u) => u.id) } }, _count: true });
  return users.map((u) => ({ ...u, assignedLeads: leadCounts.find((c) => c.assignedRepId === u.id)?._count ?? 0 }));
}

export async function createUser(actor: Actor, raw: { name: string; email: string; role: string; phone?: string | null; password: string }) {
  assertCan(actor, "users.manage", "Only the coordinator can add users.");
  const d = userSchema.parse(raw);
  const pw = password.parse(raw.password);
  if (await prisma.user.findUnique({ where: { email: d.email } })) throw conflict("A user with that email already exists.");
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { ...d, phone: d.phone || null, passwordHash: hash(pw) } });
    await audit(tx, actor, "user.created", { type: "User", id: u.id }, `Added ${d.role === "REP" ? "sales rep" : "coordinator"} ${d.name} <${d.email}>`);
    return u;
  });
}

export async function updateUser(actor: Actor, id: string, raw: { name: string; email: string; role: string; phone?: string | null }) {
  assertCan(actor, "users.manage", "Only the coordinator can edit users.");
  const d = userSchema.parse(raw);
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) throw notFound("User");
  if (d.email !== u.email && (await prisma.user.findUnique({ where: { email: d.email } }))) throw conflict("A user with that email already exists.");
  if (u.role === "COORDINATOR" && d.role !== "COORDINATOR") {
    if (u.id === actor.id) throw invalid("You can't change your own role.");
    if (u.active && (await activeCoordinatorCount(u.id)) === 0) throw invalid("There must be at least one active coordinator.");
  }
  if (u.role === "REP" && d.role === "COORDINATOR" && (await prisma.lead.count({ where: { assignedRepId: u.id, archivedAt: null } }))) {
    throw invalid("Reassign this rep's leads before making them a coordinator.");
  }
  const roleChanged = d.role !== u.role;
  return prisma.$transaction(async (tx) => {
    const up = await tx.user.update({ where: { id }, data: { ...d, phone: d.phone || null, ...(roleChanged ? { sessionVersion: { increment: 1 } } : {}) } });
    await audit(tx, actor, "user.updated", { type: "User", id }, `Updated ${up.name}${roleChanged ? ` (role ${u.role.toLowerCase()} → ${d.role.toLowerCase()}; signed out)` : ""}`);
    return up;
  });
}

/** Deactivating signs the user out everywhere and blocks login. History (visits, sales) is kept. */
export async function setUserActive(actor: Actor, id: string, active: boolean) {
  assertCan(actor, "users.manage", "Only the coordinator can deactivate users.");
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) throw notFound("User");
  if (!active && u.id === actor.id) throw invalid("You can't deactivate your own account.");
  if (!active && u.role === "COORDINATOR" && (await activeCoordinatorCount(u.id)) === 0) throw invalid("There must be at least one active coordinator.");
  const assigned = active ? 0 : await prisma.lead.count({ where: { assignedRepId: u.id, archivedAt: null } });
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { active, sessionVersion: { increment: 1 } } });
    await audit(tx, actor, active ? "user.reactivated" : "user.deactivated", { type: "User", id }, `${active ? "Reactivated" : "Deactivated"} ${u.name}${assigned ? ` (still assigned ${assigned} lead(s))` : ""}`);
  });
  return { assignedLeads: assigned };
}

export async function resetPassword(actor: Actor, id: string, newPassword: string) {
  assertCan(actor, "users.manage", "Only the coordinator can reset passwords.");
  const pw = password.parse(newPassword);
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) throw notFound("User");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash: hash(pw), sessionVersion: { increment: 1 } } });
    await audit(tx, actor, "user.passwordReset", { type: "User", id }, `Reset password for ${u.name} (signed out of all devices)`);
  });
}

/** Any user: change your own password (requires the current one). Other sessions are signed out. */
export async function changeOwnPassword(actor: Actor, current: string, next: string) {
  const pw = password.parse(next);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await bcrypt.compare(current, u.passwordHash))) throw invalid("Your current password is incorrect.");
  if (current === next) throw invalid("Choose a password different from your current one.");
  return prisma.$transaction(async (tx) => {
    const up = await tx.user.update({ where: { id: u.id }, data: { passwordHash: hash(pw), sessionVersion: { increment: 1 } } });
    await audit(tx, actor, "user.passwordChanged", { type: "User", id: u.id }, "Changed own password (other devices signed out)");
    return { id: up.id, role: up.role as Role, sessionVersion: up.sessionVersion };
  });
}
