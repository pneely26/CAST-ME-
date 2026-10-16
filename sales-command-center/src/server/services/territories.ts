import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import { assertCan, type Actor } from "../policy";
import { conflict, invalid, notFound } from "../errors";

const nameSchema = z.string().trim().min(1, "Name is required").max(100);

export async function saveTerritory(actor: Actor, input: { id?: string; name: string; color?: string; notes?: string | null }) {
  assertCan(actor, "territory.manage", "Only the coordinator can manage territories.");
  const name = nameSchema.parse(input.name);
  const color = /^#[0-9a-f]{6}$/i.test(input.color ?? "") ? input.color! : "#4f46e5";
  return prisma.$transaction(async (tx) => {
    const clash = await tx.territory.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(input.id ? { id: { not: input.id } } : {}) } });
    if (clash) throw conflict(`A territory named “${clash.name}” already exists.`);
    const t = input.id
      ? await tx.territory.update({ where: { id: input.id }, data: { name, color, notes: input.notes ?? null } })
      : await tx.territory.create({ data: { name, color, notes: input.notes ?? null } });
    await audit(tx, actor, input.id ? "territory.updated" : "territory.created", { type: "Territory", id: t.id }, `${input.id ? "Updated" : "Created"} territory ${t.name}`);
    return t;
  });
}

export async function saveArea(actor: Actor, input: { id?: string; territoryId: string; name: string; notes?: string | null }) {
  assertCan(actor, "territory.manage", "Only the coordinator can manage areas.");
  const name = nameSchema.parse(input.name);
  return prisma.$transaction(async (tx) => {
    const t = await tx.territory.findUnique({ where: { id: input.territoryId } });
    if (!t) throw invalid("Choose a territory for this area.");
    const clash = await tx.area.findFirst({ where: { territoryId: t.id, name: { equals: name, mode: "insensitive" }, ...(input.id ? { id: { not: input.id } } : {}) } });
    if (clash) throw conflict(`“${clash.name}” already exists in ${t.name}.`);
    const before = input.id ? await tx.area.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !before) throw notFound("Area");
    const a = input.id
      ? await tx.area.update({ where: { id: input.id }, data: { name, territoryId: t.id, notes: input.notes ?? null } })
      : await tx.area.create({ data: { name, territoryId: t.id, notes: input.notes ?? null } });
    // keep leads' territory consistent if an area moves territory
    if (before && before.territoryId !== t.id) await tx.lead.updateMany({ where: { areaId: a.id }, data: { territoryId: t.id } });
    await audit(tx, actor, input.id ? "area.updated" : "area.created", { type: "Area", id: a.id }, `${input.id ? "Updated" : "Created"} area ${a.name} (${t.name})`);
    return a;
  });
}

export async function archiveTerritoryOrArea(actor: Actor, kind: "territory" | "area", id: string, archived: boolean) {
  assertCan(actor, "territory.manage");
  return prisma.$transaction(async (tx) => {
    if (kind === "territory") {
      const t = await tx.territory.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
      await audit(tx, actor, archived ? "territory.archived" : "territory.restored", { type: "Territory", id }, `${archived ? "Archived" : "Restored"} territory ${t.name} (leads keep their assignment)`);
    } else {
      const a = await tx.area.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
      await audit(tx, actor, archived ? "area.archived" : "area.restored", { type: "Area", id }, `${archived ? "Archived" : "Restored"} area ${a.name}`);
    }
  });
}

export async function territoryOptions() {
  const territories = await prisma.territory.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, include: { areas: { where: { archivedAt: null }, orderBy: { name: "asc" } } } });
  return territories;
}
