import { describe, it, expect } from "vitest";
import { normalizeTitle, normalizedTitleString, normalizeCastingDirector, splitCastingDirectors, normalizeRole } from "@/lib/normalize";

describe("project title normalization", () => {
  it("treats word order of untitled platform titles as equivalent", () => {
    expect(normalizedTitleString("Untitled Paramount+ Series")).toBe(normalizedTitleString("Paramount+ Untitled Series"));
    expect(normalizeTitle("Untitled Paramount+ Series").isGeneric).toBe(true);
  });
  it("handles Paramount Plus spelled out", () => {
    expect(normalizedTitleString("Paramount Plus Untitled Series")).toBe(normalizedTitleString("Untitled Paramount+ Series"));
  });
  it("strips punctuation, case, articles, season markers", () => {
    expect(normalizedTitleString("THE Lakeshore Hours — Season 2")).toBe(normalizedTitleString("Lakeshore Hours"));
    expect(normalizedTitleString("Lakeshore Hours (S2)")).toBe("hours lakeshore");
  });
  it("removes working-title annotations and accents", () => {
    expect(normalizedTitleString("Café Society (w/t)")).toBe(normalizedTitleString("Cafe Society"));
  });
  it("distinguishes different untitled platforms", () => {
    expect(normalizedTitleString("Untitled Netflix Series")).not.toBe(normalizedTitleString("Untitled Hulu Series"));
  });
  it("keeps distinctive tokens", () => {
    const n = normalizeTitle("Untitled Hulu Drama: Southside");
    expect(n.isGeneric).toBe(false);
    expect(n.coreTokens).toEqual(["southside"]);
    expect(n.platformTokens).toEqual(["hulu"]);
  });
});

describe("casting director normalization", () => {
  it("normalizes CSA suffix, case and punctuation", () => {
    expect(normalizeCastingDirector("Jane Q. Doe, CSA")).toBe("jane doe");
    expect(normalizeCastingDirector("JANE DOE C.S.A.")).toBe("jane doe");
  });
  it("flips Last, First", () => {
    expect(normalizeCastingDirector("Doe, Jane")).toBe("jane doe");
  });
  it("strips accents", () => {
    expect(normalizeCastingDirector("José Ramírez")).toBe("jose ramirez");
  });
  it("splits multiple casting directors", () => {
    expect(splitCastingDirectors("Jane Doe & John Roe, CSA")).toEqual(["Jane Doe", "John Roe, CSA"]);
    expect(splitCastingDirectors("Jane Doe / John Roe")).toHaveLength(2);
  });
  it("normalizes roles", () => {
    expect(normalizeRole("[DETECTIVE MARIA]")).toBe(normalizeRole("Detective Maria"));
  });
});
