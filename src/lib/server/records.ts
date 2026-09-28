import type { Prisma, Region, Visibility } from "@prisma/client";
import { prisma } from "./db";
import { normalizeCastingDirector, normalizedTitleString, splitCastingDirectors, normalizeTitle } from "../normalize";
import { compareRecords, type MatchResult } from "../matching/fuzzy";
import { canonicalPlatform } from "../constants";

type Tx = Prisma.TransactionClient;

/** Find or create casting director records for a raw credit ("Jane Doe & John Roe, CSA"). */
export async function ensureCastingDirectors(
  raw: string | null | undefined,
  opts: { office?: string | null; sourceName?: string | null; sourceUrl?: string | null; isDemo?: boolean; verified?: boolean },
  tx: Tx = prisma,
) {
  const names = splitCastingDirectors(raw);
  const out = [];
  for (const name of names) {
    const cleaned = name.replace(/,?\s*C\.?S\.?A\.?$/i, "").trim();
    const normalizedName = normalizeCastingDirector(cleaned);
    if (!normalizedName) continue;
    const existing = await tx.castingDirector.findUnique({ where: { normalizedName } });
    if (existing) {
      if (!existing.castingOffice && opts.office) {
        await tx.castingDirector.update({ where: { id: existing.id }, data: { castingOffice: opts.office } });
      }
      out.push(existing);
      continue;
    }
    out.push(
      await tx.castingDirector.create({
        data: {
          name: cleaned,
          normalizedName,
          castingOffice: opts.office ?? null,
          sourceName: opts.sourceName ?? null,
          sourceUrl: opts.sourceUrl ?? null,
          verifiedAt: opts.verified ? new Date() : null,
          isDemo: opts.isDemo ?? false,
        },
      }),
    );
  }
  return out;
}

export async function linkCasting(projectId: string, castingDirectorIds: string[], office: string | null | undefined, role: string, tx: Tx = prisma) {
  for (const castingDirectorId of castingDirectorIds) {
    await tx.projectCasting.upsert({
      where: { projectId_castingDirectorId: { projectId, castingDirectorId } },
      update: {},
      create: { projectId, castingDirectorId, castingOffice: office ?? null, role },
    });
  }
}

export interface ProjectMatchCandidate {
  projectId: string;
  title: string;
  platform: string | null;
  agencyReported: boolean;
  match: MatchResult;
}

/**
 * Find existing projects that may be the same as an incoming record.
 * Used by imports to offer "attach to existing" vs "create new" — never auto-merges uncertain ones.
 */
export async function findProjectCandidates(input: {
  title: string;
  castingDirector?: string | null;
  platform?: string | null;
  region?: string | null;
  role?: string | null;
  includeAgencyOnly?: boolean;
}): Promise<ProjectMatchCandidate[]> {
  const projects = await loadProjectRecords(input.includeAgencyOnly ?? false);
  return projects
    .map((p) => ({
      projectId: p.projectId,
      title: p.title,
      platform: p.platform ?? null,
      agencyReported: p.agencyReported,
      match: compareRecords(
        { title: input.title, castingDirector: input.castingDirector, platform: input.platform, region: input.region, role: input.role },
        p,
      ),
    }))
    .filter((c) => c.match.verdict !== "NO_MATCH")
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, 5);
}

export interface ProjectRecord {
  projectId: string;
  title: string;
  castingDirector: string | null;
  castingOffice: string | null;
  roles: string[];
  platform: string | null;
  region: string | null;
  dates: Date[];
  agencyReported: boolean;
}

/** Load projects as match records. publicOnly => projects that have at least one public breakdown. */
export async function loadProjectRecords(includeAgencyOnly: boolean): Promise<ProjectRecord[]> {
  const projects = await prisma.project.findMany({
    where: includeAgencyOnly ? {} : { breakdowns: { some: {} } },
    include: {
      castings: { include: { castingDirector: true } },
      breakdowns: { select: { roleName: true, postedDate: true, importedAt: true, castingDirectorRaw: true, castingOfficeRaw: true, region: true } },
    },
  });
  return projects.map((p) => {
    const cds = new Set<string>();
    p.castings.forEach((c) => cds.add(c.castingDirector.name));
    p.breakdowns.forEach((b) => b.castingDirectorRaw && splitCastingDirectors(b.castingDirectorRaw).forEach((n) => cds.add(n)));
    const offices = new Set<string>();
    p.castings.forEach((c) => c.castingOffice && offices.add(c.castingOffice));
    p.breakdowns.forEach((b) => b.castingOfficeRaw && offices.add(b.castingOfficeRaw));
    return {
      projectId: p.id,
      title: p.title,
      castingDirector: cds.size ? [...cds].join(" & ") : null,
      castingOffice: offices.size ? [...offices][0] : null,
      roles: p.breakdowns.map((b) => b.roleName).filter((r): r is string => Boolean(r)),
      platform: p.platform,
      region: p.region ?? p.breakdowns.find((b) => b.region)?.region ?? null,
      dates: p.breakdowns.map((b) => b.postedDate ?? b.importedAt),
      agencyReported: p.agencyReported,
    };
  });
}

export interface NewBreakdownInput {
  projectId?: string | null; // attach to this project; otherwise create
  project: string;
  platform?: string | null;
  productionType?: string | null;
  unionStatus?: string | null;
  region?: Region | null;
  genre?: string | null;
  filmingLocation?: string | null;
  castingDirector?: string | null;
  castingOffice?: string | null;
  roleName?: string | null;
  roleType?: string | null;
  characterDescription?: string | null;
  ageRange?: string | null;
  gender?: string | null;
  ethnicity?: string | null;
  postedDate?: Date | null;
  submissionDeadline?: Date | null;
  visibility?: Visibility;
  source: string;
  sourceUrl?: string | null;
  verified?: boolean;
  isDemo?: boolean;
}

/** Create a public breakdown (and its project, casting links) in one transaction. */
export async function createBreakdown(input: NewBreakdownInput) {
  // Rows from the bundled sample files are labelled "DEMO DATA" in their source column.
  input = { ...input, isDemo: input.isDemo ?? /demo data/i.test(input.source) };
  return prisma.$transaction(async (tx) => {
    let projectId = input.projectId ?? null;
    const now = new Date();
    if (projectId) {
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      // A public breakdown means the project now exists in the public dataset.
      await tx.project.update({
        where: { id: p.id },
        data: {
          agencyReported: false,
          platform: p.platform ?? input.platform ?? null,
          productionType: p.productionType ?? input.productionType ?? null,
          unionStatus: p.unionStatus ?? input.unionStatus ?? null,
          region: p.region ?? input.region ?? null,
          sourceName: p.sourceName && !p.agencyReported ? p.sourceName : input.source,
          sourceUrl: p.sourceUrl && !p.agencyReported ? p.sourceUrl : (input.sourceUrl ?? null),
          verifiedAt: input.verified ? now : p.verifiedAt,
        },
      });
    } else {
      const created = await tx.project.create({
        data: {
          title: input.project,
          normalizedTitle: normalizedTitleString(input.project),
          platform: canonicalPlatform(input.platform),
          productionType: input.productionType ?? null,
          unionStatus: input.unionStatus ?? null,
          region: input.region ?? null,
          genre: input.genre ?? null,
          filmingLocation: input.filmingLocation ?? null,
          status: input.visibility === "CLOSED" ? "CASTING_CLOSED" : "ACTIVE",
          sourceName: input.source,
          sourceUrl: input.sourceUrl ?? null,
          verifiedAt: input.verified ? now : null,
          isDemo: input.isDemo ?? false,
        },
      });
      projectId = created.id;
    }
    const cds = await ensureCastingDirectors(
      input.castingDirector,
      { office: input.castingOffice, sourceName: input.source, sourceUrl: input.sourceUrl, isDemo: input.isDemo, verified: input.verified },
      tx,
    );
    await linkCasting(projectId, cds.map((c) => c.id), input.castingOffice, "Casting Director", tx);
    return tx.publicBreakdown.create({
      data: {
        projectId,
        source: input.source,
        region: input.region ?? null,
        postedDate: input.postedDate ?? null,
        submissionDeadline: input.submissionDeadline ?? null,
        visibility: input.visibility ?? "UNKNOWN",
        sourceUrl: input.sourceUrl ?? null,
        verifiedAt: input.verified ? now : null,
        roleName: input.roleName ?? null,
        roleType: input.roleType ?? null,
        characterDescription: input.characterDescription ?? null,
        ageRange: input.ageRange ?? null,
        gender: input.gender ?? null,
        ethnicity: input.ethnicity ?? null,
        unionStatus: input.unionStatus ?? null,
        castingDirectorRaw: input.castingDirector ?? null,
        castingOfficeRaw: input.castingOffice ?? null,
        isDemo: input.isDemo ?? false,
      },
    });
  });
}

/** Is there already a breakdown for the same project + role + posted date? */
export async function findDuplicateBreakdown(projectId: string | null, title: string, role: string | null, postedDate: Date | null) {
  const normalizedTitle = normalizedTitleString(title);
  const list = await prisma.publicBreakdown.findMany({
    where: projectId ? { projectId } : { project: { normalizedTitle } },
    select: { id: true, roleName: true, postedDate: true, projectId: true },
  });
  const r = (role ?? "").trim().toLowerCase();
  return (
    list.find(
      (b) =>
        (b.roleName ?? "").trim().toLowerCase() === r &&
        ((!b.postedDate && !postedDate) ||
          (b.postedDate && postedDate && Math.abs(b.postedDate.getTime() - postedDate.getTime()) < 2 * 86_400_000)),
    ) ?? null
  );
}

export function titleIsGeneric(title: string) {
  return normalizeTitle(title).isGeneric;
}
