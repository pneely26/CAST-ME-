import { describe, it, expect } from "vitest";
import { compareRecords, titleSimilarity, castingDirectorSimilarity, diceCoefficient } from "@/lib/matching/fuzzy";

const d = (s: string) => new Date(s + "T12:00:00Z");

describe("fuzzy matching", () => {
  it("dice coefficient basics", () => {
    expect(diceCoefficient("night", "night")).toBe(1);
    expect(diceCoefficient("night", "nacht")).toBeLessThan(0.5);
  });
  it("same project, slightly different title -> likely match (CASE 4)", () => {
    const r = compareRecords(
      { title: "The Lakeshore Hours", castingDirector: "Jane Doe, CSA", platform: "Netflix", region: "CHICAGO", role: "Denise", date: d("2026-09-01") },
      { title: "Lakeshore Hours (Season 2)", castingDirector: "Doe, Jane", platform: "netflix", region: "CHICAGO", roles: ["DENISE", "Marcus"], dates: [d("2026-08-29")] },
    );
    expect(r.verdict).toBe("LIKELY_MATCH");
    expect(r.score).toBeGreaterThan(0.9);
  });
  it("untitled platform series with same CD -> likely match", () => {
    const r = compareRecords(
      { title: "Untitled Paramount+ Series", castingDirector: "Mara Kell", platform: "Paramount+" },
      { title: "Paramount+ Untitled Series", castingDirector: "Mara Kell CSA", platform: "Paramount+" },
    );
    expect(r.verdict).toBe("LIKELY_MATCH");
  });
  it("untitled titles without casting director corroboration are never auto-matched", () => {
    const r = compareRecords(
      { title: "Untitled Paramount+ Series", platform: "Paramount+" },
      { title: "Paramount+ Untitled Series", platform: "Paramount+" },
    );
    expect(r.verdict).toBe("UNCERTAIN");
  });
  it("similar titles but different projects -> uncertain (CASE 3)", () => {
    const r = compareRecords(
      { title: "The Last Summer", castingDirector: "Ann Ruiz", platform: "Netflix", region: "LOS_ANGELES" },
      { title: "Last Summers", castingDirector: "Tom Becker", platform: "Hulu", region: "ATLANTA" },
    );
    expect(r.verdict).toBe("UNCERTAIN");
    expect(r.conflicts).toContain("Different platforms");
  });
  it("unrelated projects -> no match", () => {
    const r = compareRecords(
      { title: "Crosstown Blues", castingDirector: "Ann Ruiz", platform: "HBO" },
      { title: "Harbor Lights", castingDirector: "Tom Becker", platform: "Apple TV+" },
    );
    expect(r.verdict).toBe("NO_MATCH");
  });
  it("titles are order insensitive", () => {
    expect(titleSimilarity("Blues Crosstown", "Crosstown Blues").score).toBe(1);
  });
  it("casting director similarity handles multi-CD credits", () => {
    expect(castingDirectorSimilarity("Jane Doe & John Roe", "John Roe CSA")).toBe(1);
    expect(castingDirectorSimilarity("J. Doe", "Jane Doe")).toBeGreaterThanOrEqual(0.85);
    expect(castingDirectorSimilarity(null, "Jane Doe")).toBeNull();
  });
});
