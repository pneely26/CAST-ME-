import type { ActorProfile, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { computeRelevance, type ProfileLike } from "../matching/profile";
import { DEFAULT_PLATFORMS } from "../constants";

export const DEFAULT_PROFILE = {
  id: "default",
  name: "Paige",
  profession: "Actor",
  union: "SAG-AFTRA",
  location: "Chicago",
  castingRange: "20s–30s",
  playingAgeMin: 20,
  playingAgeMax: 39,
  gender: "Female",
  castingProfile: "Black woman",
  primaryWork: ["TV", "Film", "Theatre"],
  training: ["Meisner"],
  additional: ["Dance", "Singer", "AEA"],
  targetMarkets: ["Chicago", "Atlanta", "Los Angeles", "New York"],
  targetPlatforms: DEFAULT_PLATFORMS.filter((p) => p !== "Other"),
  roleTypes: [] as string[],
};

export async function getProfile(): Promise<ActorProfile> {
  const p = await prisma.actorProfile.findUnique({ where: { id: "default" } });
  if (p) return p;
  return prisma.actorProfile.create({ data: DEFAULT_PROFILE });
}

export function toProfileLike(p: ActorProfile): ProfileLike {
  return {
    union: p.union,
    playingAgeMin: p.playingAgeMin,
    playingAgeMax: p.playingAgeMax,
    gender: p.gender,
    castingProfile: p.castingProfile,
    primaryWork: p.primaryWork,
    additional: p.additional,
    targetMarkets: p.targetMarkets,
    targetPlatforms: p.targetPlatforms,
    roleTypes: p.roleTypes,
  };
}

type BreakdownWithProject = Prisma.PublicBreakdownGetPayload<{ include: { project: true } }>;

export function relevanceFor(b: BreakdownWithProject, profile: ProfileLike) {
  return computeRelevance(
    {
      ageRange: b.ageRange,
      gender: b.gender,
      ethnicity: b.ethnicity,
      unionStatus: b.unionStatus ?? b.project.unionStatus,
      region: b.region ?? b.project.region,
      productionType: b.project.productionType,
      characterDescription: b.characterDescription,
      roleType: b.roleType,
      platform: b.project.platform,
    },
    profile,
  );
}

export async function updateBreakdownRelevance(ids?: string[]) {
  const profile = toProfileLike(await getProfile());
  const list = await prisma.publicBreakdown.findMany({
    where: ids ? { id: { in: ids } } : undefined,
    include: { project: true },
  });
  for (const b of list) {
    const r = relevanceFor(b, profile);
    await prisma.publicBreakdown.update({
      where: { id: b.id },
      data: { relevance: r.tier, relevanceDetails: r as unknown as Prisma.InputJsonValue },
    });
  }
  return list.length;
}

export async function getPlatforms(): Promise<string[]> {
  const custom = await prisma.platform.findMany({ where: { isCustom: true }, orderBy: { name: "asc" } });
  const base = DEFAULT_PLATFORMS.filter((p) => p !== "Other");
  return [...base, ...custom.map((c) => c.name).filter((n) => !base.includes(n)), "Other"];
}
