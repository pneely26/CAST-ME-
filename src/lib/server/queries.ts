import { prisma } from "./db";

export const breakdownInclude = {
  project: { include: { castings: { include: { castingDirector: true } } } },
} as const;

/** Casting directors by number of distinct projects in the window (frequency only, not a ranking of quality). */
export async function castingDirectorActivity(days = 90, limit = 8, relevantOnly = false) {
  const since = new Date(Date.now() - days * 86_400_000);
  const cds = await prisma.castingDirector.findMany({
    include: {
      castings: {
        where: {
          project: {
            OR: [
              { breakdowns: { some: { importedAt: { gte: since }, ...(relevantOnly ? { relevance: { in: ["HIGH", "POSSIBLE"] } } : {}) } } },
              ...(relevantOnly ? [] : [{ submissions: { some: { importedAt: { gte: since } } } }]),
            ],
          },
        },
        include: { project: { select: { id: true, title: true, updatedAt: true } } },
      },
    },
  });
  return cds
    .map((c) => ({ id: c.id, name: c.name, office: c.castingOffice, city: c.city, count: c.castings.length, isDemo: c.isDemo, projects: c.castings.map((x) => x.project.title) }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}
