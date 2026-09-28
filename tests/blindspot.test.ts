import { describe, it, expect } from "vitest";
import { detectBlindSpot, isDuplicateSubmission, type PublicCandidate } from "@/lib/matching/blindspot";
import { BLIND_SPOT_EXPLANATION } from "@/lib/constants";
import { sourceState } from "@/lib/deadlines";

const d = (s: string) => new Date(s + "T12:00:00Z");

const publicSet: PublicCandidate[] = [
  { projectId: "p1", title: "The Lakeshore Hours", castingDirector: "Jane Doe", platform: "Netflix", region: "CHICAGO", roles: ["Denise"], dates: [d("2026-09-01")] },
  { projectId: "p2", title: "Last Summer", castingDirector: "Tom Becker", platform: "Hulu", region: "ATLANTA", roles: ["Kim"], dates: [d("2026-09-10")] },
  { projectId: "p3", title: "Harbor Lights", castingDirector: "Lee Park", platform: "Apple TV+", region: "NEW_YORK", roles: ["Nora"], dates: [d("2026-08-15")] },
];

describe("blind spot detection", () => {
  it("CASE 1: public project + agency submission -> PUBLIC_MATCH", () => {
    const r = detectBlindSpot(
      { projectTitleRaw: "Lakeshore Hours", castingDirectorRaw: "Jane Doe CSA", platform: "Netflix", region: "CHICAGO", role: "Denise", dateSubmitted: d("2026-09-03") },
      publicSet,
    );
    expect(r.classification).toBe("PUBLIC_MATCH");
    expect(r.bestCandidate?.projectId).toBe("p1");
  });

  it("CASE 2: agency submission with no public project -> AGENCY_REPORTED_NOT_FOUND", () => {
    const r = detectBlindSpot(
      { projectTitleRaw: "Iron & Velvet", castingDirectorRaw: "Rosa Grant", platform: "HBO", region: "LOS_ANGELES", role: "Tasha", dateSubmitted: d("2026-09-05") },
      publicSet,
    );
    expect(r.classification).toBe("AGENCY_REPORTED_NOT_FOUND");
    expect(r.explanation).toBe(BLIND_SPOT_EXPLANATION);
    expect(r.explanation).not.toMatch(/exclusive|agent-only/i);
  });

  it("CASE 3: similar title but different project -> NEEDS_REVIEW", () => {
    const r = detectBlindSpot(
      { projectTitleRaw: "The Last Summer", castingDirectorRaw: "Ann Ruiz", platform: "Netflix", region: "LOS_ANGELES", role: "June", dateSubmitted: d("2026-09-12") },
      publicSet,
    );
    expect(r.classification).toBe("NEEDS_REVIEW");
    expect(r.bestCandidate?.projectId).toBe("p2");
  });

  it("CASE 4: same project, slightly different title -> PUBLIC_MATCH (likely match)", () => {
    const r = detectBlindSpot(
      { projectTitleRaw: "Harbour Lights (w/t)", castingDirectorRaw: "Lee Park", platform: "Apple TV+", region: "NEW_YORK", role: "Nora", dateSubmitted: d("2026-08-18") },
      publicSet,
    );
    expect(r.classification).toBe("PUBLIC_MATCH");
    expect(r.bestCandidate?.projectId).toBe("p3");
  });

  it("CASE 5: closed public breakdown -> CASTING CLOSED", () => {
    expect(sourceState({ visibility: "CLOSED", verifiedAt: new Date() })).toBe("CASTING_CLOSED");
    expect(sourceState({ submissionDeadline: d("2020-01-01"), verifiedAt: new Date() })).toBe("CASTING_CLOSED");
  });

  it("flags duplicates of existing agency submissions", () => {
    const existing = [{ id: "s1", projectTitleRaw: "Iron and Velvet", role: "Tasha", dateSubmitted: d("2026-09-04") }];
    const r = detectBlindSpot({ projectTitleRaw: "IRON & VELVET", role: "tasha", dateSubmitted: d("2026-09-05") }, publicSet, existing);
    expect(r.classification).toBe("POSSIBLE_DUPLICATE");
    expect(r.duplicateOf).toBe("s1");
  });

  it("duplicate detection requires same role and nearby dates", () => {
    expect(isDuplicateSubmission({ projectTitleRaw: "A Show", role: "X", dateSubmitted: d("2026-01-01") }, { projectTitleRaw: "A Show", role: "Y", dateSubmitted: d("2026-01-01") })).toBe(false);
    expect(isDuplicateSubmission({ projectTitleRaw: "A Show", role: "X", dateSubmitted: d("2026-01-01") }, { projectTitleRaw: "A Show", role: "X", dateSubmitted: d("2026-03-01") })).toBe(false);
  });

  it("uncertain untitled matches are sent to review rather than merged", () => {
    const r = detectBlindSpot(
      { projectTitleRaw: "Untitled Paramount+ Series", platform: "Paramount+" },
      [{ projectId: "px", title: "Paramount+ Untitled Series", platform: "Paramount+" }],
    );
    expect(r.classification).toBe("NEEDS_REVIEW");
  });

  it("two equally likely candidates -> NEEDS_REVIEW", () => {
    const r = detectBlindSpot(
      { projectTitleRaw: "Harbor Lights", castingDirectorRaw: "Lee Park", platform: "Apple TV+" },
      [
        { projectId: "a", title: "Harbor Lights", castingDirector: "Lee Park", platform: "Apple TV+" },
        { projectId: "b", title: "Harbor Lights", castingDirector: "Lee Park", platform: "Apple TV+" },
      ],
    );
    expect(r.classification).toBe("NEEDS_REVIEW");
  });
});
