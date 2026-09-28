import {
  normalizeTitle,
  normalizeCastingDirector,
  normalizeOffice,
  normalizeRole,
  splitCastingDirectors,
} from "../normalize";
import { canonicalPlatform } from "../constants";

/** Sørensen–Dice coefficient on character bigrams (0..1). */
export function diceCoefficient(a: string, b: string): number {
  const x = a.replace(/\s+/g, " ").trim();
  const y = b.replace(/\s+/g, " ").trim();
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      overlap++;
    }
  }
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface TitleSimilarity {
  score: number;
  bothGeneric: boolean;
  anyGeneric: boolean;
}

/** Title similarity using normalized, order-insensitive tokens. */
export function titleSimilarity(a: string, b: string): TitleSimilarity {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  const bothGeneric = na.isGeneric && nb.isGeneric;
  const anyGeneric = na.isGeneric || nb.isGeneric;
  if (na.normalized && na.normalized === nb.normalized) return { score: 1, bothGeneric, anyGeneric };
  if (bothGeneric) {
    // Both are untitled/working titles. Similar only if platform words agree.
    const pa = na.platformTokens;
    const pb = nb.platformTokens;
    const platformAgree = pa.length > 0 && pb.length > 0 && pa.some((p) => pb.includes(p));
    return { score: platformAgree ? 0.85 : 0.5, bothGeneric, anyGeneric };
  }
  if (anyGeneric) return { score: 0.1, bothGeneric, anyGeneric };
  const tokenScore = jaccard(na.coreTokens, nb.coreTokens);
  const charScore = diceCoefficient(na.coreTokens.join(" "), nb.coreTokens.join(" "));
  const sortedChar = diceCoefficient([...na.coreTokens].sort().join(" "), [...nb.coreTokens].sort().join(" "));
  // containment: "Crosstown" vs "Crosstown Blues" -> partial credit
  const shorter = na.coreTokens.length <= nb.coreTokens.length ? na.coreTokens : nb.coreTokens;
  const longer = shorter === na.coreTokens ? nb.coreTokens : na.coreTokens;
  const contained = shorter.length > 0 && shorter.every((t) => longer.includes(t));
  let score = Math.max(tokenScore, charScore, sortedChar);
  if (contained) score = Math.max(score, 0.7 + 0.3 * (shorter.length / longer.length) * 0.5);
  return { score: Math.min(1, score), bothGeneric, anyGeneric };
}

/** Compare two casting-director credits (may each contain multiple names). */
export function castingDirectorSimilarity(a: string | null | undefined, b: string | null | undefined): number | null {
  const la = splitCastingDirectors(a).map(normalizeCastingDirector).filter(Boolean);
  const lb = splitCastingDirectors(b).map(normalizeCastingDirector).filter(Boolean);
  if (la.length === 0 || lb.length === 0) return null;
  let best = 0;
  for (const x of la) {
    for (const y of lb) {
      if (x === y) return 1;
      const xt = x.split(" ");
      const yt = y.split(" ");
      const lastEq = xt[xt.length - 1] === yt[yt.length - 1];
      const firstInitialEq = xt[0]?.[0] === yt[0]?.[0];
      if (lastEq && firstInitialEq) best = Math.max(best, 0.85);
      else best = Math.max(best, diceCoefficient(x, y) * (lastEq ? 1 : 0.8));
    }
  }
  return best;
}

export function officeSimilarity(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = normalizeOffice(a);
  const y = normalizeOffice(b);
  if (!x || !y) return null;
  return diceCoefficient(x, y);
}

export function roleSimilarity(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = normalizeRole(a);
  const y = normalizeRole(b);
  if (!x || !y) return null;
  if (x === y) return 1;
  return diceCoefficient(x, y);
}

export function platformSimilarity(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = canonicalPlatform(a);
  const y = canonicalPlatform(b);
  if (!x || !y || x === "Other" || y === "Other") return null;
  return x.toLowerCase() === y.toLowerCase() ? 1 : 0;
}

export function regionSimilarity(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  if (a === b) return 1;
  if (a === "NATIONWIDE" || b === "NATIONWIDE") return 0.7;
  if ((a === "ATLANTA" && b === "SOUTHEAST") || (a === "SOUTHEAST" && b === "ATLANTA")) return 0.8;
  return 0;
}

/** Date proximity: 1 within 7 days, decaying to 0 at 120 days. */
export function dateProximity(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null;
  const days = Math.abs(a.getTime() - b.getTime()) / 86_400_000;
  if (days <= 7) return 1;
  if (days >= 120) return 0;
  return 1 - (days - 7) / (120 - 7);
}

export interface MatchRecord {
  title: string;
  castingDirector?: string | null;
  castingOffice?: string | null;
  role?: string | null;
  roles?: string[];
  platform?: string | null;
  region?: string | null;
  date?: Date | null;
  dates?: Date[];
}

export type MatchVerdict = "LIKELY_MATCH" | "UNCERTAIN" | "NO_MATCH";

export interface MatchFactor {
  factor: string;
  score: number | null; // null = not comparable (missing data)
  weight: number;
  note: string;
}

export interface MatchResult {
  score: number;
  verdict: MatchVerdict;
  factors: MatchFactor[];
  conflicts: string[];
}

const WEIGHTS = {
  title: 0.45,
  castingDirector: 0.2,
  platform: 0.1,
  role: 0.1,
  date: 0.1,
  region: 0.05,
};

export const LIKELY_MATCH_THRESHOLD = 0.75;
export const UNCERTAIN_THRESHOLD = 0.45;

function describe(score: number | null, label: string): string {
  if (score === null) return `${label}: not enough data to compare`;
  if (score >= 0.95) return `${label}: same`;
  if (score >= 0.75) return `${label}: very similar`;
  if (score >= 0.5) return `${label}: somewhat similar`;
  return `${label}: different`;
}

/**
 * Compare two project/opportunity records. Explainable weighted similarity.
 * Missing fields are excluded from the weighting rather than counted as mismatches.
 * Explicit conflicts (different platform, different casting director) prevent LIKELY_MATCH.
 */
export function compareRecords(a: MatchRecord, b: MatchRecord): MatchResult {
  const t = titleSimilarity(a.title, b.title);
  const rolesA = a.roles ?? (a.role ? [a.role] : []);
  const rolesB = b.roles ?? (b.role ? [b.role] : []);
  let role: number | null = null;
  for (const ra of rolesA) for (const rb of rolesB) {
    const s = roleSimilarity(ra, rb);
    if (s !== null) role = Math.max(role ?? 0, s);
  }
  const datesA = a.dates ?? (a.date ? [a.date] : []);
  const datesB = b.dates ?? (b.date ? [b.date] : []);
  let date: number | null = null;
  for (const da of datesA) for (const db of datesB) {
    const s = dateProximity(da, db);
    if (s !== null) date = Math.max(date ?? 0, s);
  }
  let cd = castingDirectorSimilarity(a.castingDirector, b.castingDirector);
  const office = officeSimilarity(a.castingOffice, b.castingOffice);
  if (office !== null && (cd === null || office > cd)) cd = cd === null ? office * 0.9 : Math.max(cd, office * 0.9);
  const platform = platformSimilarity(a.platform, b.platform);
  const region = regionSimilarity(a.region, b.region);

  const factors: MatchFactor[] = [
    {
      factor: "Title",
      score: t.score,
      weight: WEIGHTS.title,
      note: t.bothGeneric
        ? `Title: both are untitled/working titles (${t.score >= 0.8 ? "same platform wording" : "no distinctive words"})`
        : describe(t.score, "Title"),
    },
    { factor: "Casting director", score: cd, weight: WEIGHTS.castingDirector, note: describe(cd, "Casting director/office") },
    { factor: "Platform", score: platform, weight: WEIGHTS.platform, note: describe(platform, "Platform") },
    { factor: "Role", score: role, weight: WEIGHTS.role, note: describe(role, "Role") },
    {
      factor: "Date proximity",
      score: date,
      weight: WEIGHTS.date,
      note: date === null ? "Date: not enough data to compare" : date >= 0.95 ? "Date: within a week" : date > 0 ? "Date: within a few months" : "Date: far apart",
    },
    { factor: "Region", score: region, weight: WEIGHTS.region, note: describe(region, "Region") },
  ];

  let num = 0;
  let den = 0;
  for (const f of factors) {
    if (f.score === null) continue;
    num += f.score * f.weight;
    den += f.weight;
  }
  let score = den > 0 ? num / den : 0;

  const conflicts: string[] = [];
  if (platform === 0) conflicts.push("Different platforms");
  if (cd !== null && cd < 0.5) conflicts.push("Different casting directors");
  if (region === 0) conflicts.push("Different regions");

  // Untitled/working titles need corroboration from casting director.
  if (t.bothGeneric && (cd === null || cd < 0.85)) score = Math.min(score, LIKELY_MATCH_THRESHOLD - 0.01);
  if (t.anyGeneric && !t.bothGeneric) score = Math.min(score, LIKELY_MATCH_THRESHOLD - 0.01);

  let verdict: MatchVerdict;
  if (score >= LIKELY_MATCH_THRESHOLD && conflicts.length === 0) verdict = "LIKELY_MATCH";
  else if (score >= UNCERTAIN_THRESHOLD || (t.score >= 0.7 && !t.anyGeneric)) verdict = "UNCERTAIN";
  else verdict = "NO_MATCH";

  // A strong title match with conflicts is always sent to review, never silently merged.
  if (verdict === "LIKELY_MATCH" && t.score < 0.6) verdict = "UNCERTAIN";

  return { score: Math.round(score * 1000) / 1000, verdict, factors, conflicts };
}
