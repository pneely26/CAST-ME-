/**
 * Explainable actor-profile relevance.
 *
 * Only information EXPLICITLY stated in a breakdown is compared. Nothing is inferred from
 * character descriptions, names, or project themes. No numeric "talent score" is produced —
 * only HIGH / POSSIBLE / LOW relevance with a per-factor explanation.
 */
import { basicFold } from "../normalize";
import { canonicalPlatform, REGION_LABELS, type RegionCode } from "../constants";

export type RelevanceTier = "HIGH" | "POSSIBLE" | "LOW";
export type FactorOutcome = "MATCH" | "OPEN" | "MISMATCH" | "NOT_STATED" | "INFO";

export interface ProfileLike {
  union: string;
  playingAgeMin: number;
  playingAgeMax: number;
  gender: string;
  castingProfile: string;
  primaryWork: string[];
  additional: string[];
  targetMarkets: string[];
  targetPlatforms: string[];
  roleTypes: string[];
}

export interface BreakdownLike {
  ageRange?: string | null;
  gender?: string | null;
  ethnicity?: string | null;
  unionStatus?: string | null;
  region?: string | null;
  productionType?: string | null;
  characterDescription?: string | null;
  roleType?: string | null;
  platform?: string | null;
}

export interface RelevanceFactor {
  factor: string;
  outcome: FactorOutcome;
  detail: string;
}

export interface RelevanceResult {
  tier: RelevanceTier;
  factors: RelevanceFactor[];
  summary: string;
}

/** Parse an age range string. Returns null if nothing explicit. */
export function parseAgeRange(input: string | null | undefined): { min: number; max: number } | null {
  if (!input) return null;
  const s = basicFold(input).replace(/[–—]/g, "-").replace(/\bto\b/g, "-");
  if (/\b(all ages|any age|open|18\s*\+?\s*-?\s*(and )?(up|older|over))\b/.test(s) && !/\d+\s*-\s*\d+/.test(s)) {
    if (/18/.test(s)) return { min: 18, max: 99 };
    return { min: 0, max: 99 };
  }
  const decade = (word: string, qual?: string) => {
    const base = parseInt(word, 10);
    if (qual === "early") return { min: base, max: base + 3 };
    if (qual === "mid") return { min: base + 3, max: base + 6 };
    if (qual === "late") return { min: base + 6, max: base + 9 };
    return { min: base, max: base + 9 };
  };
  // "20s-30s", "late 20s to early 30s", "mid 30s"
  const decades = [...s.matchAll(/(early|mid|late)?[\s-]*(\d0)'?s\b/g)];
  if (decades.length >= 1) {
    const first = decade(decades[0][2], decades[0][1]);
    const last = decade(decades[decades.length - 1][2], decades[decades.length - 1][1]);
    return { min: first.min, max: last.max };
  }
  const range = s.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
  if (range) {
    const a = parseInt(range[1], 10);
    const b = parseInt(range[2], 10);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const plus = s.match(/(\d{1,2})\s*\+/);
  if (plus) return { min: parseInt(plus[1], 10), max: 99 };
  const single = s.match(/\b(\d{1,2})\b/);
  if (single) {
    const n = parseInt(single[1], 10);
    return { min: n - 2, max: n + 2 };
  }
  return null;
}

const OPEN_WORDS = /\b(any|all|open|every|no preference|not specified|n\/a|all genders|all ethnicities|any ethnicity|open ethnicity|seeking all|diverse)\b/;

function genderKey(s: string): "female" | "male" | "nonbinary" | "open" | null {
  const f = basicFold(s);
  if (OPEN_WORDS.test(f)) return "open";
  if (/\b(non[- ]?binary|nb|gender[- ]?fluid|gender[- ]?nonconforming)\b/.test(f)) return "nonbinary";
  const female = /\b(female|woman|women|girl|f)\b/.test(f);
  const male = /\b(male|man|men|boy|m)\b/.test(f);
  if (female && male) return "open";
  if (female) return "female";
  if (male) return "male";
  return null;
}

const ETHNICITY_TERMS: Record<string, string[]> = {
  black: ["black", "african american", "african-american", "afro", "african"],
  white: ["white", "caucasian"],
  latine: ["latino", "latina", "latinx", "latine", "hispanic"],
  asian: ["asian", "east asian", "south asian", "southeast asian", "aapi"],
  mena: ["middle eastern", "north african", "mena", "arab"],
  indigenous: ["indigenous", "native american", "first nations", "alaska native"],
  pacific: ["pacific islander", "native hawaiian"],
  multiracial: ["multiracial", "mixed race", "biracial"],
};

function ethnicityGroups(s: string): string[] {
  const f = basicFold(s);
  const out: string[] = [];
  for (const [group, terms] of Object.entries(ETHNICITY_TERMS)) {
    if (terms.some((t) => new RegExp(`\\b${t}\\b`).test(f))) out.push(group);
  }
  return out;
}

function unionKeys(s: string): string[] {
  const f = basicFold(s);
  const keys: string[] = [];
  if (/sag|aftra/.test(f)) keys.push("sag-aftra");
  if (/\baea\b|equity/.test(f)) keys.push("aea");
  if (/non[- ]?union|nonunion/.test(f)) keys.push("non-union");
  if (/\bagma\b/.test(f)) keys.push("agma");
  if (/\bagva\b/.test(f)) keys.push("agva");
  return keys;
}

const PRODUCTION_GROUPS: Record<string, string[]> = {
  tv: ["tv", "television", "series", "episodic", "pilot", "limited", "streaming", "sitcom", "miniseries"],
  film: ["film", "feature", "movie", "short"],
  theatre: ["theatre", "theater", "stage", "musical", "play", "broadway", "off-broadway"],
};

function productionGroups(s: string): string[] {
  const f = basicFold(s);
  return Object.entries(PRODUCTION_GROUPS)
    .filter(([, words]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(f)))
    .map(([g]) => g);
}

// Explicit skill mentions in a character description, mapped to profile "additional" entries
const SKILL_TERMS: Record<string, RegExp> = {
  dance: /\b(dance|dancer|dancing|choreograph\w*|ballet|hip[- ]hop|tap)\b/,
  singer: /\b(sing|singer|singing|vocal(ist)?|sings)\b/,
};

export function computeRelevance(breakdown: BreakdownLike, profile: ProfileLike): RelevanceResult {
  const factors: RelevanceFactor[] = [];

  // Age
  const age = parseAgeRange(breakdown.ageRange);
  if (!age) factors.push({ factor: "Age", outcome: "NOT_STATED", detail: "Age: not stated in breakdown" });
  else {
    const overlap = age.min <= profile.playingAgeMax && age.max >= profile.playingAgeMin;
    factors.push({
      factor: "Age",
      outcome: overlap ? "MATCH" : "MISMATCH",
      detail: overlap
        ? `Age: potentially matches (breakdown ${breakdown.ageRange}; profile ${profile.playingAgeMin}–${profile.playingAgeMax})`
        : `Age: outside stated range (breakdown ${breakdown.ageRange})`,
    });
  }

  // Gender (explicit only)
  const g = breakdown.gender ? genderKey(breakdown.gender) : null;
  const pg = genderKey(profile.gender);
  if (!breakdown.gender || g === null) factors.push({ factor: "Gender", outcome: "NOT_STATED", detail: "Gender: not stated in breakdown" });
  else if (g === "open") factors.push({ factor: "Gender", outcome: "OPEN", detail: `Gender: open (${breakdown.gender})` });
  else
    factors.push({
      factor: "Gender",
      outcome: g === pg ? "MATCH" : "MISMATCH",
      detail: g === pg ? `Gender: matches stated requirement (${breakdown.gender})` : `Gender: stated requirement differs (${breakdown.gender})`,
    });

  // Ethnicity / casting requirement (explicit only)
  if (!breakdown.ethnicity || !breakdown.ethnicity.trim()) {
    factors.push({ factor: "Ethnicity", outcome: "NOT_STATED", detail: "Ethnicity: not stated — nothing inferred" });
  } else if (OPEN_WORDS.test(basicFold(breakdown.ethnicity))) {
    factors.push({ factor: "Ethnicity", outcome: "OPEN", detail: `Ethnicity: open (${breakdown.ethnicity})` });
  } else {
    const req = ethnicityGroups(breakdown.ethnicity);
    const mine = ethnicityGroups(profile.castingProfile);
    if (req.length === 0) {
      factors.push({ factor: "Ethnicity", outcome: "INFO", detail: `Ethnicity: stated as “${breakdown.ethnicity}” — review manually` });
    } else {
      const hit = req.some((r) => mine.includes(r));
      factors.push({
        factor: "Ethnicity",
        outcome: hit ? "MATCH" : "MISMATCH",
        detail: hit
          ? `Ethnicity: explicitly stated, potentially matches (${breakdown.ethnicity})`
          : `Ethnicity: explicitly stated requirement differs (${breakdown.ethnicity})`,
      });
    }
  }

  // Union
  if (!breakdown.unionStatus) factors.push({ factor: "Union", outcome: "NOT_STATED", detail: "Union: not stated" });
  else {
    const req = unionKeys(breakdown.unionStatus);
    const mine = [...unionKeys(profile.union), ...profile.additional.flatMap(unionKeys)];
    const hit = req.some((r) => mine.includes(r));
    const nonUnionOnly = req.length === 1 && req[0] === "non-union";
    factors.push({
      factor: "Union",
      outcome: hit ? "MATCH" : nonUnionOnly ? "MISMATCH" : req.length ? "INFO" : "INFO",
      detail: hit
        ? `Union: ${breakdown.unionStatus}`
        : nonUnionOnly
          ? `Union: non-union only (${profile.union} members — check union rules)`
          : `Union: ${breakdown.unionStatus}`,
    });
  }

  // Region
  if (!breakdown.region) factors.push({ factor: "Region", outcome: "NOT_STATED", detail: "Region: not stated" });
  else {
    const label = REGION_LABELS[breakdown.region as RegionCode] ?? breakdown.region;
    const markets = profile.targetMarkets.map((m) => basicFold(m));
    const hit = breakdown.region === "NATIONWIDE" || markets.includes(basicFold(label));
    factors.push({
      factor: "Region",
      outcome: hit ? "MATCH" : "INFO",
      detail: hit ? `Region: ${label}` : `Region: ${label} (not a target market)`,
    });
  }

  // Production type
  if (!breakdown.productionType) factors.push({ factor: "Production", outcome: "NOT_STATED", detail: "Production: not stated" });
  else {
    const groups = productionGroups(breakdown.productionType);
    const mine = profile.primaryWork.flatMap(productionGroups);
    const hit = groups.some((x) => mine.includes(x));
    factors.push({
      factor: "Production",
      outcome: hit ? "MATCH" : "INFO",
      detail: hit ? `Production: ${breakdown.productionType}` : `Production: ${breakdown.productionType} (outside primary work)`,
    });
  }

  // Role type (informational unless the profile lists preferred role types)
  if (breakdown.roleType) {
    const pref = profile.roleTypes.map(basicFold);
    const hit = pref.length > 0 && pref.includes(basicFold(breakdown.roleType));
    factors.push({
      factor: "Role type",
      outcome: hit ? "MATCH" : "INFO",
      detail: `Role type: ${breakdown.roleType}`,
    });
  }

  // Character description — only explicit skill mentions that appear in the profile
  if (breakdown.characterDescription) {
    const d = basicFold(breakdown.characterDescription);
    const additional = profile.additional.map(basicFold);
    const skills = Object.entries(SKILL_TERMS)
      .filter(([skill, re]) => re.test(d) && additional.some((a) => a.startsWith(skill.slice(0, 4))))
      .map(([skill]) => skill);
    factors.push({
      factor: "Character description",
      outcome: skills.length ? "MATCH" : "INFO",
      detail: skills.length
        ? `Character description: potentially relevant (explicitly mentions ${skills.join(", ")})`
        : "Character description: review manually",
    });
  }

  // Platform
  if (breakdown.platform) {
    const p = canonicalPlatform(breakdown.platform);
    const hit = profile.targetPlatforms.some((t) => canonicalPlatform(t)?.toLowerCase() === p?.toLowerCase());
    factors.push({ factor: "Platform", outcome: hit ? "MATCH" : "INFO", detail: hit ? `Platform: ${p} (target platform)` : `Platform: ${p}` });
  }

  const byName = (n: string) => factors.find((f) => f.factor === n);
  const mismatches = factors.filter((f) => f.outcome === "MISMATCH");
  const matches = factors.filter((f) => f.outcome === "MATCH");
  const coreOk = ["Age", "Gender"].every((n) => ["MATCH", "OPEN"].includes(byName(n)?.outcome ?? ""));

  let tier: RelevanceTier;
  if (mismatches.length > 0) tier = "LOW";
  else if (coreOk && matches.length >= 3) tier = "HIGH";
  else if (matches.length >= 2) tier = "POSSIBLE";
  else tier = "LOW";

  const summary =
    tier === "HIGH"
      ? "High relevance based on explicitly stated breakdown details."
      : tier === "POSSIBLE"
        ? "Possible relevance — some stated details align; others are not stated."
        : mismatches.length
          ? `Low relevance — ${mismatches.map((m) => m.factor.toLowerCase()).join(", ")} stated differently.`
          : "Low relevance — too few explicit details to compare.";

  return { tier, factors, summary };
}
