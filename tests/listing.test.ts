import { describe, it, expect } from "vitest";
import { parseListingText, parseAgencyText, looksLikeAgencyEmail, parseLooseDate, findAge, findGender, findEthnicity } from "@/lib/listing/parse";

const now = new Date("2026-10-15T12:00:00Z");

const BREAKDOWN = `"THE LAKESHORE HOURS"
Episodic - Season 2
Network: Netflix
Casting Director: Dana Whitfield, CSA
Casting Office: Whitfield Casting
Location: Chicago, IL
Union: SAG-AFTRA
Rate: Scale
Submissions Due: Oct 22

[DENISE PORTER] Female, 28-35, Black / African American. Recurring. A sharp, warm ER nurse who keeps the night shift running. Must be comfortable with medical jargon.

[MARCUS] Male, 30s, all ethnicities. Guest Star. Denise's estranged brother.
`;

describe("paste listing parser", () => {
  it("reads a standard breakdown with header labels and bracketed roles", () => {
    const p = parseListingText(BREAKDOWN, { now });
    expect(p.project).toBe("The Lakeshore Hours");
    expect(p.platform).toBe("Netflix");
    expect(p.productionType).toBe("TV Series");
    expect(p.castingDirector).toBe("Dana Whitfield");
    expect(p.castingOffice).toBe("Whitfield Casting");
    expect(p.region).toBe("CHICAGO");
    expect(p.union).toBe("SAG-AFTRA");
    expect(p.deadline).toBe("2026-10-22");
    expect(p.roles).toHaveLength(2);
    expect(p.roles[0]).toMatchObject({ roleName: "Denise Porter", gender: "Female", ageRange: "28-35", roleType: "Recurring", ethnicity: "Black / African American" });
    expect(p.roles[1]).toMatchObject({ roleName: "Marcus", gender: "Male", ageRange: "30s", roleType: "Guest Star", ethnicity: "all ethnicities" });
  });

  it("reads ALL-CAPS role headers and labelled role fields", () => {
    const p = parseListingText(`Project: Peach State
Type: Feature Film
Shoot Location: Atlanta, GA
KIRA (female, early 20s to mid 30s) Co-Star. Ambitious architect.
Role: Officer Hale
Gender: Male
Age: 40-50`, { now });
    expect(p.project).toBe("Peach State");
    expect(p.productionType).toBe("Feature Film");
    expect(p.region).toBe("ATLANTA");
    expect(p.roles.map((r) => r.roleName)).toEqual(["Kira", "Officer Hale"]);
    expect(p.roles[0].ageRange).toBe("early 20s to mid 30s");
    expect(p.roles[1]).toMatchObject({ gender: "Male", ageRange: "40-50" });
  });

  it("never invents an ethnicity from a description", () => {
    const p = parseListingText(`[JUNE] Female, 25-30. A jazz singer from the South Side.`, { now });
    expect(p.roles[0].ethnicity).toBeNull();
  });

  it("uses an email subject for the project when the body has none", () => {
    const p = parseListingText(`We're seeking a female lead, 25-35, SAG-AFTRA, shooting in New York. Deadline: 10/30`, { subject: "Casting Call: Harbor Lights", now });
    expect(p.project).toBe("Harbor Lights");
    expect(p.region).toBe("NEW_YORK");
    expect(p.deadline).toBe("2026-10-30");
  });

  it("dates", () => {
    expect(parseLooseDate("Friday, October 30th", now)?.toISOString().slice(0, 10)).toBe("2026-10-30");
    expect(parseLooseDate("Jan 5", now)?.toISOString().slice(0, 10)).toBe("2027-01-05");
    expect(parseLooseDate("10/20/26", now)?.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(parseLooseDate("soon", now)).toBeNull();
  });

  it("helpers", () => {
    expect(findAge("ages 18-25")).toBe("18-25");
    expect(findGender("seeking women")).toBe("Female");
    expect(findEthnicity("Latina or Hispanic")).toBe("Latina / Hispanic");
    expect(findEthnicity("ER nurse")).toBeNull();
  });
});

describe("agency email parser", () => {
  it("reads submission emails", () => {
    const a = parseAgencyText(`Hi Paige,\nWe submitted you today.\nCasting: Rosa Grant\nNetwork: HBO\nLocation: Los Angeles`, { subject: "Submitted: Iron & Velvet - Tasha", receivedAt: new Date("2026-10-14T15:00:00Z"), now });
    expect(a.project).toBe("Iron & Velvet");
    expect(a.role).toBe("Tasha");
    expect(a.castingDirector).toBe("Rosa Grant");
    expect(a.platform).toBe("HBO");
    expect(a.region).toBe("LOS_ANGELES");
    expect(a.dateSubmitted).toBe("2026-10-14");
    expect(a.status).toBe("Submitted");
  });
  it("detects self-tape requests and labelled projects", () => {
    const a = parseAgencyText(`Project: Glass Houses\nRole: Maya\nThey'd like a self-tape request by Friday.`, { subject: "Fwd: update", now });
    expect(a.project).toBe("Glass Houses");
    expect(a.role).toBe("Maya");
    expect(a.status).toMatch(/Self.?tape/i);
  });
  it("classifies agency emails", () => {
    expect(looksLikeAgencyEmail("Agent <jo@agency.com>", "hello", ["agency.com"])).toBe(true);
    expect(looksLikeAgencyEmail("news@castingsite.org", "We submitted you for Peach State", [])).toBe(true);
    expect(looksLikeAgencyEmail("news@castingsite.org", "Now casting: Peach State", [])).toBe(false);
  });
});

describe("agency email body sentences", () => {
  it("reads project and role from the message body", () => {
    const a = parseAgencyText("Hi Paige! Great news, we submitted you for HARBOR LIGHTS - Nora Vance. Casting: Lena Park.", { now });
    expect(a.project).toBe("Harbor Lights");
    expect(a.role).toBe("Nora Vance");
    const b = parseAgencyText("We submitted you for the role of Maya on Glass Houses.", { now });
    expect(b).toMatchObject({ project: "Glass Houses", role: "Maya" });
  });
});

describe("greetings are not project titles", () => {
  it("skips 'Hi Paige,' lines", () => {
    const a = parseAgencyText("Hi Paige,\nWe submitted you for Glass Houses - Maya.\nBest,\nJo", { now });
    expect(a.project).toBe("Glass Houses");
    expect(a.role).toBe("Maya");
    const l = parseListingText("Hello there\nSeeking actors for a short film. Deadline: Nov 1", { now });
    expect(l.project).toBeNull();
  });
});
