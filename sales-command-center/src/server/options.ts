import { prisma } from "./db";

/** Shared dropdown data. */
export async function repOptions() {
  return prisma.user.findMany({ where: { role: "REP", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export async function areaOptions() {
  const areas = await prisma.area.findMany({ where: { archivedAt: null, territory: { archivedAt: null } }, include: { territory: true }, orderBy: [{ territory: { name: "asc" } }, { name: "asc" }] });
  return areas.map((a) => ({ id: a.id, label: `${a.territory.name} · ${a.name}`, territoryId: a.territoryId, name: a.name }));
}
