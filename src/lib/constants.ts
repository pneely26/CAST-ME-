export const REGIONS = [
  "CHICAGO",
  "NEW_YORK",
  "LOS_ANGELES",
  "ATLANTA",
  "SOUTHEAST",
  "NATIONWIDE",
  "OTHER",
] as const;
export type RegionCode = (typeof REGIONS)[number];

export const REGION_LABELS: Record<RegionCode, string> = {
  CHICAGO: "Chicago",
  NEW_YORK: "New York",
  LOS_ANGELES: "Los Angeles",
  ATLANTA: "Atlanta",
  SOUTHEAST: "Southeast",
  NATIONWIDE: "Nationwide",
  OTHER: "Other",
};

const REGION_ALIASES: Record<string, RegionCode> = {
  chicago: "CHICAGO",
  chi: "CHICAGO",
  "chicago il": "CHICAGO",
  illinois: "CHICAGO",
  "new york": "NEW_YORK",
  "new york city": "NEW_YORK",
  nyc: "NEW_YORK",
  ny: "NEW_YORK",
  "new york ny": "NEW_YORK",
  "los angeles": "LOS_ANGELES",
  la: "LOS_ANGELES",
  "l a": "LOS_ANGELES",
  "los angeles ca": "LOS_ANGELES",
  hollywood: "LOS_ANGELES",
  atlanta: "ATLANTA",
  atl: "ATLANTA",
  "atlanta ga": "ATLANTA",
  georgia: "ATLANTA",
  southeast: "SOUTHEAST",
  "south east": "SOUTHEAST",
  "se": "SOUTHEAST",
  nationwide: "NATIONWIDE",
  national: "NATIONWIDE",
  "us nationwide": "NATIONWIDE",
  "usa": "NATIONWIDE",
  "self tape nationwide": "NATIONWIDE",
  other: "OTHER",
};

/** Parse a free-text region into a Region code. Returns null for blank input. */
export function parseRegion(input: unknown): RegionCode | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if ((REGIONS as readonly string[]).includes(upper)) return upper as RegionCode;
  const key = raw
    .toLowerCase()
    .replace(/[.,/()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (REGION_ALIASES[key]) return REGION_ALIASES[key];
  for (const [alias, code] of Object.entries(REGION_ALIASES)) {
    if (alias.length > 3 && key.includes(alias)) return code;
  }
  return "OTHER";
}

export const DEFAULT_PLATFORMS = [
  "Netflix",
  "Paramount+",
  "Hulu",
  "HBO",
  "Max",
  "Apple TV+",
  "Peacock",
  "NBC",
  "ABC",
  "CBS",
  "FOX",
  "BET",
  "FX",
  "Freeform",
  "Disney+",
  "Amazon MGM",
  "Starz",
  "Other",
];

const PLATFORM_ALIASES: Record<string, string> = {
  "paramount plus": "Paramount+",
  paramount: "Paramount+",
  "apple tv plus": "Apple TV+",
  "apple tv": "Apple TV+",
  "apple": "Apple TV+",
  "disney plus": "Disney+",
  disney: "Disney+",
  "hbo max": "Max",
  amazon: "Amazon MGM",
  "amazon prime": "Amazon MGM",
  "prime video": "Amazon MGM",
  "amazon studios": "Amazon MGM",
  "amazon mgm studios": "Amazon MGM",
  fox: "FOX",
  nbc: "NBC",
  abc: "ABC",
  cbs: "CBS",
  bet: "BET",
  "bet+": "BET",
  fx: "FX",
};

/** Canonicalize a platform name. Unknown names are kept (custom platforms allowed). */
export function canonicalPlatform(input: unknown, known: string[] = DEFAULT_PLATFORMS): string | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const exact = known.find((p) => p.toLowerCase() === lower);
  if (exact) return exact;
  const key = lower.replace(/\+/g, " plus").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (PLATFORM_ALIASES[key]) return PLATFORM_ALIASES[key];
  if (PLATFORM_ALIASES[lower]) return PLATFORM_ALIASES[lower];
  return raw;
}

export const PRODUCTION_TYPES = [
  "TV Series",
  "Limited Series",
  "Pilot",
  "Feature Film",
  "Short Film",
  "Theatre",
  "Musical",
  "Commercial",
  "New Media",
  "Other",
];

export const PROJECT_STATUSES = ["ACTIVE", "CASTING_CLOSED", "IN_PRODUCTION", "WRAPPED", "UNKNOWN"] as const;
export const VISIBILITIES = ["PUBLIC", "UNKNOWN", "CLOSED"] as const;
export const CLASSIFICATIONS = [
  "PUBLIC_MATCH",
  "AGENCY_REPORTED_NOT_FOUND",
  "POSSIBLE_DUPLICATE",
  "NEEDS_REVIEW",
] as const;
export const REVIEW_STATUSES = ["UNREVIEWED", "CONFIRMED_PUBLIC", "CONFIRMED_NOT_FOUND", "DISMISSED"] as const;
export const WATCH_TYPES = ["CASTING_DIRECTOR", "CASTING_OFFICE", "PLATFORM", "PROJECT", "REGION"] as const;

/** The only wording used to explain a potential blind spot. */
export const BLIND_SPOT_EXPLANATION = "Agency-reported project not found in current public dataset.";

export function humanize(code: string | null | undefined): string {
  if (!code) return "—";
  if ((REGIONS as readonly string[]).includes(code)) return REGION_LABELS[code as RegionCode];
  return code
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
