import type { Prisma, AgencySubmission, BlindSpotClassification } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { detectBlindSpot, type DetectionResult, type SubmissionInput } from "../matching/blindspot";
import { loadProjectRecords, ensureCastingDirectors, linkCasting } from "./records";
import { normalizedTitleString } from "../normalize";
import { canonicalPlatform } from "../constants";

function toInput(s: AgencySubmission): SubmissionInput {
  return {
    id: s.id,
    projectTitleRaw: s.projectTitleRaw,
    role: s.role,
    castingDirectorRaw: s.castingDirectorRaw,
    dateSubmitted: s.dateSubmitted,
    platform: s.platform,
    region: s.region,
  };
}

/** Preview-only detection (no DB writes). */
export async function previewDetection(inputs: SubmissionInput[]): Promise<DetectionResult[]> {
  const candidates = await loadProjectRecords(false);
  const existing = (await prisma.agencySubmission.findMany()).map(toInput);
  const seen: SubmissionInput[] = [...existing];
  return inputs.map((i) => {
    const r = detectBlindSpot(i, candidates, seen);
    seen.push({ ...i, id: i.id ?? `new-${seen.length}` });
    return r;
  });
}

async function ensureAgencyProject(s: AgencySubmission, tx: Prisma.TransactionClient): Promise<string> {
  if (s.projectId) {
    const current = await tx.project.findUnique({ where: { id: s.projectId } });
    if (current?.agencyReported) return current.id;
  }
  const normalizedTitle = normalizedTitleString(s.projectTitleRaw);
  const platform = canonicalPlatform(s.platform);
  // Reuse an agency-only project only on an exact normalized title (+ compatible platform).
  const existing = await tx.project.findFirst({
    where: {
      agencyReported: true,
      normalizedTitle,
      OR: [{ platform: null }, { platform: platform ?? undefined }],
    },
  });
  if (existing) return existing.id;
  const p = await tx.project.create({
    data: {
      title: s.projectTitleRaw,
      normalizedTitle,
      platform,
      unionStatus: s.unionStatus,
      region: s.region,
      status: "UNKNOWN",
      sourceName: "Agency report",
      agencyReported: true,
      isDemo: s.isDemo,
      notes: "Created from an agency-reported submission. Not found in the public dataset at creation time.",
    },
  });
  return p.id;
}

async function deleteOrphanAgencyProject(projectId: string | null, tx: Prisma.TransactionClient) {
  if (!projectId) return;
  const p = await tx.project.findUnique({
    where: { id: projectId },
    include: { _count: { select: { submissions: true, breakdowns: true, blindSpots: true, watchItems: true } } },
  });
  if (p && p.agencyReported && p._count.submissions === 0 && p._count.breakdowns === 0 && p._count.blindSpots === 0 && p._count.watchItems === 0) {
    await tx.project.delete({ where: { id: projectId } });
  }
}

/**
 * Run blind-spot detection for one submission and persist the result.
 * Human-reviewed results are never overwritten (use force for an explicit re-run).
 */
export async function runDetection(submissionId: string, opts: { force?: boolean } = {}) {
  const s = await prisma.agencySubmission.findUniqueOrThrow({ where: { id: submissionId }, include: { blindSpot: true } });
  if (s.blindSpot && s.blindSpot.reviewStatus !== "UNREVIEWED" && !opts.force) return s.blindSpot;

  const candidates = await loadProjectRecords(false);
  const others = (await prisma.agencySubmission.findMany({ where: { id: { not: s.id }, importedAt: { lte: s.importedAt } } })).map(toInput);
  const result = detectBlindSpot(toInput(s), candidates, others);
  return persistDetection(s, result);
}

export async function persistDetection(s: AgencySubmission & { blindSpot?: { id: string; classification: BlindSpotClassification } | null }, result: DetectionResult) {
  const previous = s.blindSpot ?? (await prisma.blindSpot.findUnique({ where: { agencySubmissionId: s.id } }));
  const bs = await prisma.$transaction(async (tx) => {
    let projectId: string;
    const oldProjectId = s.projectId;
    if (result.classification === "PUBLIC_MATCH" && result.bestCandidate) {
      projectId = result.bestCandidate.projectId;
    } else {
      projectId = await ensureAgencyProject(s, tx);
    }
    await tx.agencySubmission.update({ where: { id: s.id }, data: { projectId } });
    // agency-reported casting director credit
    const cds = await ensureCastingDirectors(s.castingDirectorRaw, { sourceName: "Agency report", isDemo: s.isDemo }, tx);
    await linkCasting(projectId, cds.map((c) => c.id), null, "Casting Director (agency-reported)", tx);

    const data = {
      projectId,
      candidateProjectId: result.bestCandidate?.projectId ?? null,
      classification: result.classification,
      confidence: Math.round(result.confidence * 1000) / 1000,
      matchDetails: {
        explanation: result.explanation,
        duplicateOf: result.duplicateOf,
        candidates: result.candidates.map((c) => ({
          projectId: c.projectId,
          title: c.title,
          score: c.match.score,
          verdict: c.match.verdict,
          conflicts: c.match.conflicts,
          factors: c.match.factors,
        })),
      } as unknown as Prisma.InputJsonValue,
      detectionDate: new Date(),
    };
    const saved = previous
      ? await tx.blindSpot.update({ where: { id: previous.id }, data })
      : await tx.blindSpot.create({ data: { ...data, agencySubmissionId: s.id } });
    if (oldProjectId && oldProjectId !== projectId) await deleteOrphanAgencyProject(oldProjectId, tx);
    return saved;
  });

  const title = s.projectTitleRaw;
  if (!previous && bs.classification !== "PUBLIC_MATCH") {
    await audit("BLIND_SPOT_CREATED", "BlindSpot", bs.id, `${humanClass(bs.classification)}: ${title}`, { classification: bs.classification, confidence: bs.confidence });
  } else if (previous && previous.classification !== "PUBLIC_MATCH" && bs.classification === "PUBLIC_MATCH") {
    await audit("BLIND_SPOT_RESOLVED", "BlindSpot", bs.id, `Now found in public dataset: ${title}`, { from: previous.classification });
  } else if (previous && previous.classification !== bs.classification) {
    await audit("EDIT", "BlindSpot", bs.id, `Re-classified ${title}: ${humanClass(previous.classification)} → ${humanClass(bs.classification)}`);
  }
  return bs;
}

function humanClass(c: string) {
  return c.replace(/_/g, " ").toLowerCase();
}

/** Re-run detection for all unreviewed submissions (e.g. after a public import). */
export async function rerunUnreviewed() {
  const subs = await prisma.agencySubmission.findMany({
    where: { OR: [{ blindSpot: null }, { blindSpot: { reviewStatus: "UNREVIEWED" } }] },
    orderBy: { importedAt: "asc" },
    select: { id: true },
  });
  for (const s of subs) await runDetection(s.id);
  return subs.length;
}

/** Explicit user decision on an uncertain match. */
export async function resolveBlindSpot(
  blindSpotId: string,
  decision: "SAME_AS_CANDIDATE" | "NOT_FOUND" | "DISMISS" | "REOPEN",
  opts: { candidateProjectId?: string; notes?: string } = {},
) {
  const bs = await prisma.blindSpot.findUniqueOrThrow({ where: { id: blindSpotId }, include: { agencySubmission: true, project: true } });
  const now = new Date();
  if (decision === "SAME_AS_CANDIDATE") {
    const target = opts.candidateProjectId ?? bs.candidateProjectId;
    if (!target) throw new Error("No candidate project selected.");
    await prisma.$transaction(async (tx) => {
      const oldProjectId = bs.projectId;
      if (bs.agencySubmissionId) await tx.agencySubmission.update({ where: { id: bs.agencySubmissionId }, data: { projectId: target } });
      await tx.blindSpot.update({
        where: { id: bs.id },
        data: { projectId: target, candidateProjectId: target, classification: "PUBLIC_MATCH", reviewStatus: "CONFIRMED_PUBLIC", reviewedAt: now, notes: opts.notes ?? bs.notes },
      });
      // move agency-reported casting credits over, then clean up the orphan agency project
      if (oldProjectId !== target) {
        const credits = await tx.projectCasting.findMany({ where: { projectId: oldProjectId } });
        for (const c of credits) {
          await tx.projectCasting.upsert({
            where: { projectId_castingDirectorId: { projectId: target, castingDirectorId: c.castingDirectorId } },
            update: {},
            create: { projectId: target, castingDirectorId: c.castingDirectorId, role: c.role, castingOffice: c.castingOffice },
          });
        }
        await deleteOrphanAgencyProject(oldProjectId, tx);
      }
    });
    await audit("BLIND_SPOT_RESOLVED", "BlindSpot", bs.id, `Confirmed same as public project: ${bs.agencySubmission?.projectTitleRaw ?? bs.project.title}`, { target });
  } else if (decision === "NOT_FOUND") {
    await prisma.blindSpot.update({
      where: { id: bs.id },
      data: { classification: "AGENCY_REPORTED_NOT_FOUND", reviewStatus: "CONFIRMED_NOT_FOUND", reviewedAt: now, notes: opts.notes ?? bs.notes },
    });
    await audit("BLIND_SPOT_RESOLVED", "BlindSpot", bs.id, `Confirmed not found in public dataset: ${bs.project.title}`);
  } else if (decision === "DISMISS") {
    await prisma.blindSpot.update({ where: { id: bs.id }, data: { reviewStatus: "DISMISSED", reviewedAt: now, notes: opts.notes ?? bs.notes } });
    await audit("BLIND_SPOT_RESOLVED", "BlindSpot", bs.id, `Dismissed: ${bs.project.title}`);
  } else {
    await prisma.blindSpot.update({ where: { id: bs.id }, data: { reviewStatus: "UNREVIEWED", reviewedAt: null } });
    if (bs.agencySubmissionId) await runDetection(bs.agencySubmissionId, { force: true });
    await audit("EDIT", "BlindSpot", bs.id, `Reopened for review: ${bs.project.title}`);
  }
}
