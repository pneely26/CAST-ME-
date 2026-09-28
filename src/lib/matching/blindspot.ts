import { compareRecords, type MatchRecord, type MatchResult } from "./fuzzy";
import { normalizeRole, normalizedTitleString } from "../normalize";
import { BLIND_SPOT_EXPLANATION } from "../constants";

export type Classification =
  | "PUBLIC_MATCH"
  | "AGENCY_REPORTED_NOT_FOUND"
  | "POSSIBLE_DUPLICATE"
  | "NEEDS_REVIEW";

export interface SubmissionInput {
  id?: string;
  projectTitleRaw: string;
  role?: string | null;
  castingDirectorRaw?: string | null;
  dateSubmitted?: Date | null;
  platform?: string | null;
  region?: string | null;
}

export interface PublicCandidate extends MatchRecord {
  projectId: string;
}

export interface CandidateResult {
  projectId: string;
  title: string;
  match: MatchResult;
}

export interface DetectionResult {
  classification: Classification;
  confidence: number;
  bestCandidate: CandidateResult | null;
  candidates: CandidateResult[];
  duplicateOf: string | null;
  explanation: string;
}

export function submissionToRecord(s: SubmissionInput): MatchRecord {
  return {
    title: s.projectTitleRaw,
    castingDirector: s.castingDirectorRaw,
    role: s.role,
    platform: s.platform,
    region: s.region,
    date: s.dateSubmitted ?? null,
  };
}

/** Same project + same role within 5 days (or both undated) = likely duplicate submission record. */
export function isDuplicateSubmission(a: SubmissionInput, b: SubmissionInput): boolean {
  const ta = normalizedTitleString(a.projectTitleRaw);
  const tb = normalizedTitleString(b.projectTitleRaw);
  if (!ta || ta !== tb) return false;
  if (normalizeRole(a.role) !== normalizeRole(b.role)) return false;
  if (a.dateSubmitted && b.dateSubmitted) {
    return Math.abs(a.dateSubmitted.getTime() - b.dateSubmitted.getTime()) <= 5 * 86_400_000;
  }
  return !a.dateSubmitted && !b.dateSubmitted;
}

/**
 * Blind spot detection for one agency submission.
 * 1. duplicate check against existing submissions
 * 2. normalize and fuzzy-compare against every public project
 * 3. classify — uncertain results always go to NEEDS_REVIEW (never auto-merged)
 */
export function detectBlindSpot(
  submission: SubmissionInput,
  publicCandidates: PublicCandidate[],
  existingSubmissions: SubmissionInput[] = [],
): DetectionResult {
  const dup = existingSubmissions.find((e) => e.id !== submission.id && isDuplicateSubmission(submission, e));

  const record = submissionToRecord(submission);
  const candidates: CandidateResult[] = publicCandidates
    .map((c) => ({ projectId: c.projectId, title: c.title, match: compareRecords(record, c) }))
    .filter((c) => c.match.verdict !== "NO_MATCH")
    .sort((x, y) => y.match.score - x.match.score)
    .slice(0, 5);

  const best = candidates[0] ?? null;

  if (dup) {
    return {
      classification: "POSSIBLE_DUPLICATE",
      confidence: 0.9,
      bestCandidate: best,
      candidates,
      duplicateOf: dup.id ?? null,
      explanation: "Looks like a duplicate of an existing agency submission (same project, same role, similar date).",
    };
  }

  if (!best) {
    return {
      classification: "AGENCY_REPORTED_NOT_FOUND",
      confidence: 1 - (publicCandidates.length ? maxScore(record, publicCandidates) : 0),
      bestCandidate: null,
      candidates: [],
      duplicateOf: null,
      explanation: BLIND_SPOT_EXPLANATION,
    };
  }

  // A single likely match that clearly beats any other likely match -> public match.
  const runnerUp = candidates[1];
  const ambiguous =
    runnerUp && runnerUp.match.verdict === "LIKELY_MATCH" && best.match.score - runnerUp.match.score < 0.1;
  if (best.match.verdict === "LIKELY_MATCH" && !ambiguous) {
    return {
      classification: "PUBLIC_MATCH",
      confidence: best.match.score,
      bestCandidate: best,
      candidates,
      duplicateOf: null,
      explanation: `Found in public dataset as “${best.title}”.`,
    };
  }

  return {
    classification: "NEEDS_REVIEW",
    confidence: best.match.score,
    bestCandidate: best,
    candidates,
    duplicateOf: null,
    explanation:
      "Possible public match found, but the match is uncertain. Review before treating it as the same project" +
      (best.match.conflicts.length ? ` (${best.match.conflicts.join(", ").toLowerCase()}).` : "."),
  };
}

function maxScore(record: MatchRecord, cands: PublicCandidate[]): number {
  let m = 0;
  for (const c of cands) m = Math.max(m, compareRecords(record, c).score);
  return Math.round(m * 1000) / 1000;
}
