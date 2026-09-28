import { describe, it, expect } from "vitest";
import { computeRelevance, parseAgeRange, type ProfileLike } from "@/lib/matching/profile";

const profile: ProfileLike = {
  union: "SAG-AFTRA",
  playingAgeMin: 20,
  playingAgeMax: 39,
  gender: "Female",
  castingProfile: "Black woman",
  primaryWork: ["TV", "Film", "Theatre"],
  additional: ["Dance", "Singer", "AEA"],
  targetMarkets: ["Chicago", "Atlanta", "Los Angeles", "New York"],
  targetPlatforms: ["Netflix", "Hulu", "HBO"],
  roleTypes: [],
};

describe("age range parsing", () => {
  it("parses common formats", () => {
    expect(parseAgeRange("25-35")).toEqual({ min: 25, max: 35 });
    expect(parseAgeRange("20s-30s")).toEqual({ min: 20, max: 39 });
    expect(parseAgeRange("late 20s to early 30s")).toEqual({ min: 26, max: 33 });
    expect(parseAgeRange("45+")).toEqual({ min: 45, max: 99 });
    expect(parseAgeRange("")).toBeNull();
  });
});

describe("actor profile relevance", () => {
  it("HIGH when explicit details align", () => {
    const r = computeRelevance(
      { ageRange: "28-35", gender: "Female", unionStatus: "SAG-AFTRA", region: "CHICAGO", productionType: "TV Series", platform: "Netflix" },
      profile,
    );
    expect(r.tier).toBe("HIGH");
    expect(r.factors.find((f) => f.factor === "Age")?.detail).toMatch(/potentially matches/);
    expect(r.factors.find((f) => f.factor === "Union")?.detail).toBe("Union: SAG-AFTRA");
  });

  it("never infers ethnicity from a character description", () => {
    const r = computeRelevance(
      { ageRange: "28-35", gender: "Female", characterDescription: "A jazz singer from the South Side of Chicago." },
      profile,
    );
    const eth = r.factors.find((f) => f.factor === "Ethnicity");
    expect(eth?.outcome).toBe("NOT_STATED");
    expect(eth?.detail).toMatch(/nothing inferred/);
  });

  it("uses an explicitly stated ethnicity requirement", () => {
    const yes = computeRelevance({ ethnicity: "Black / African American", gender: "Female", ageRange: "30s" }, profile);
    expect(yes.factors.find((f) => f.factor === "Ethnicity")?.outcome).toBe("MATCH");
    const no = computeRelevance({ ethnicity: "East Asian", gender: "Female", ageRange: "30s" }, profile);
    expect(no.tier).toBe("LOW");
    const open = computeRelevance({ ethnicity: "All ethnicities", gender: "Female", ageRange: "30s" }, profile);
    expect(open.factors.find((f) => f.factor === "Ethnicity")?.outcome).toBe("OPEN");
  });

  it("LOW when stated age or gender differs", () => {
    expect(computeRelevance({ ageRange: "55-65", gender: "Female", region: "CHICAGO" }, profile).tier).toBe("LOW");
    expect(computeRelevance({ ageRange: "25-35", gender: "Male", region: "CHICAGO" }, profile).tier).toBe("LOW");
  });

  it("character description relevance only on explicit skill mentions", () => {
    const r = computeRelevance({ characterDescription: "Must be a strong singer and dancer." }, profile);
    expect(r.factors.find((f) => f.factor === "Character description")?.detail).toMatch(/singer|dance/);
  });

  it("POSSIBLE when only some details are stated", () => {
    const r = computeRelevance({ region: "ATLANTA", unionStatus: "SAG-AFTRA" }, profile);
    expect(r.tier).toBe("POSSIBLE");
  });

  it("theatre AEA union counts via profile additional", () => {
    const r = computeRelevance({ unionStatus: "AEA", productionType: "Musical" }, profile);
    expect(r.factors.find((f) => f.factor === "Union")?.outcome).toBe("MATCH");
    expect(r.factors.find((f) => f.factor === "Production")?.outcome).toBe("MATCH");
  });
});
