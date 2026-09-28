import { DEFAULT_PLATFORMS } from "./constants";

/** Strip accents, lowercase, collapse whitespace. */
export function basicFold(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

// Words that describe the *kind* of project rather than identify it.
export const GENERIC_TITLE_WORDS = new Set([
  "untitled",
  "project",
  "series",
  "show",
  "pilot",
  "limited",
  "season",
  "feature",
  "film",
  "movie",
  "drama",
  "comedy",
  "tv",
  "new",
  "episodic",
  "production",
  "working",
  "title",
  "wt",
  "aka",
]);

const STOPWORDS = new Set(["the", "a", "an", "of", "and", "for", "in", "on", "at", "to"]);

const PLATFORM_TOKENS: string[] = Array.from(
  new Set(
    DEFAULT_PLATFORMS.filter((p) => p !== "Other")
      .flatMap((p) => [p, p.replace(/\+/g, " plus")])
      .map((p) => basicFold(p).replace(/\+/g, " plus").replace(/[^a-z0-9 ]/g, " ").trim()),
  ),
).sort((a, b) => b.length - a.length);

export interface NormalizedTitle {
  /** canonical string stored in DB: distinctive tokens, sorted */
  normalized: string;
  /** distinctive tokens in original order */
  coreTokens: string[];
  /** platform names found inside the title */
  platformTokens: string[];
  /** generic words found (untitled, series, ...) */
  genericTokens: string[];
  /** true when no distinctive words remain, e.g. "Untitled Paramount+ Series" */
  isGeneric: boolean;
}

/**
 * Normalize a project title for comparison.
 * "Untitled Paramount+ Series" and "Paramount+ Untitled Series" normalize identically.
 * Season markers, working-title annotations and punctuation are removed.
 */
export function normalizeTitle(title: string | null | undefined): NormalizedTitle {
  let s = basicFold(title ?? "");
  // drop bracketed annotations like "(working title)" but keep inner words for aka "(aka Foo)"
  s = s.replace(/\((?:w\/?t|working title)\)/g, " ");
  s = s.replace(/["“”]/g, " ");
  s = s.replace(/\bseason\s+\d+\b/g, " ");
  s = s.replace(/\bs\d{1,2}(e\d{1,2})?\b/g, " ");
  s = s.replace(/\+/g, " plus ");
  s = s.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  const platformTokens: string[] = [];
  for (const p of PLATFORM_TOKENS) {
    const re = new RegExp(`(^| )${p.replace(/ /g, " ")}( |$)`);
    if (re.test(s)) {
      platformTokens.push(p);
      s = s.replace(re, " ").replace(/\s+/g, " ").trim();
    }
  }

  const tokens = s.split(" ").filter(Boolean);
  const coreTokens: string[] = [];
  const genericTokens: string[] = [];
  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    if (GENERIC_TITLE_WORDS.has(t)) genericTokens.push(t);
    else coreTokens.push(t);
  }
  const isGeneric = coreTokens.length === 0;
  const parts = isGeneric
    ? ["untitled", ...platformTokens.map((p) => p.replace(/ /g, "")), ...genericTokens.filter((g) => g !== "untitled")]
    : [...coreTokens];
  const normalized = Array.from(new Set(parts)).sort().join(" ");
  return { normalized, coreTokens, platformTokens, genericTokens, isGeneric };
}

export function normalizedTitleString(title: string | null | undefined): string {
  return normalizeTitle(title).normalized;
}

const CD_SUFFIXES = /\b(c\s*s\s*a|csa|casting|cdg|cca|associates?|inc|llc|ltd)\b/g;

/**
 * Normalize a casting director name: "DOE, Jane C.S.A." -> "jane doe".
 * Middle initials are removed.
 */
export function normalizeCastingDirector(name: string | null | undefined): string {
  if (!name) return "";
  let s = basicFold(name).replace(/\./g, " ");
  s = s.replace(CD_SUFFIXES, " ");
  s = s.replace(/[^a-z, -]/g, " ").replace(/\s+/g, " ").trim();
  // "Last, First" -> "First Last"
  const comma = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (comma.length === 2 && !comma[1].includes(" and ")) s = `${comma[1]} ${comma[0]}`;
  s = s.replace(/,/g, " ");
  const tokens = s.split(/[\s-]+/).filter(Boolean);
  // drop single-letter middle initials (keep first and last token)
  const kept = tokens.filter((t, i) => !(t.length === 1 && i > 0 && i < tokens.length - 1));
  return kept.join(" ");
}

/** Split a raw casting credit into individual names: "Jane Doe & John Roe, CSA" */
export function splitCastingDirectors(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s*(?:&|\/|;|\+|\band\b|,(?=\s*[A-Z][a-z]+\s+[A-Z]))\s*/)
    .map((x) => x.trim())
    .filter((x) => x && normalizeCastingDirector(x).length > 1);
}

export function normalizeOffice(office: string | null | undefined): string {
  if (!office) return "";
  return basicFold(office)
    .replace(/\b(casting|inc|llc|ltd|co|company|office|studios?)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRole(role: string | null | undefined): string {
  if (!role) return "";
  return basicFold(role)
    .replace(/[\[\]()"]/g, " ")
    .replace(/\b(role|the|character)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
