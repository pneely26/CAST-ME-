/** Normalization used for search, duplicate detection and display. */

export function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const BUSINESS_SUFFIXES = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|co|corp|corporation|company|pllc|pc|lp|llp|the)\b/g;

export function normalizeBusinessName(name: string | null | undefined): string {
  if (!name) return "";
  return fold(name)
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(BUSINESS_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Digits only, US country code removed: "(312) 555-0100" -> "3125550100". */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  let d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

export function formatPhone(phone: string | null | undefined): string {
  const d = normalizePhone(phone);
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return phone ?? "";
}

const STREET_WORDS: [RegExp, string][] = [
  [/\bstreet\b/g, "st"], [/\bavenue\b/g, "ave"], [/\bav\b/g, "ave"], [/\bboulevard\b/g, "blvd"], [/\broad\b/g, "rd"],
  [/\bdrive\b/g, "dr"], [/\blane\b/g, "ln"], [/\bcourt\b/g, "ct"], [/\bplace\b/g, "pl"], [/\bparkway\b/g, "pkwy"],
  [/\bhighway\b/g, "hwy"], [/\bsuite\b/g, "ste"], [/\bnorth\b/g, "n"], [/\bsouth\b/g, "s"], [/\beast\b/g, "e"], [/\bwest\b/g, "w"],
];

export function normalizeAddress(address: string | null | undefined, zip?: string | null): string {
  if (!address) return "";
  let s = fold(address).replace(/[.,#]/g, " ");
  for (const [re, rep] of STREET_WORDS) s = s.replace(re, rep);
  s = s.replace(/\b(ste|unit|apt|fl|floor)\s*\w+\b/g, " ").replace(/\s+/g, " ").trim();
  const z = (zip ?? "").replace(/\D/g, "").slice(0, 5);
  return z ? `${s} ${z}` : s;
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

/** Sørensen–Dice similarity on bigrams. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) grams.set(a.slice(i, i + 2), (grams.get(a.slice(i, i + 2)) ?? 0) + 1);
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hit++;
    }
  }
  return (2 * hit) / (a.length - 1 + b.length - 1);
}

export interface DuplicateCandidateInput {
  businessName?: string | null;
  phone?: string | null;
  address?: string | null;
  zip?: string | null;
  email?: string | null;
}

export interface ExistingLeadKey {
  id: string;
  normalizedName: string;
  normalizedPhone: string | null;
  normalizedAddress: string | null;
  email: string | null;
}

export interface DuplicateMatch {
  id: string;
  score: number;
  reasons: string[];
}

/**
 * Likely-duplicate check. Strong signals: same phone, same address, same email.
 * Name similarity alone only counts when it's very high.
 */
export function findDuplicates(input: DuplicateCandidateInput, existing: ExistingLeadKey[], threshold = 0.6): DuplicateMatch[] {
  const name = normalizeBusinessName(input.businessName);
  const phone = normalizePhone(input.phone);
  const addr = normalizeAddress(input.address, input.zip);
  const email = (input.email ?? "").trim().toLowerCase();
  const out: DuplicateMatch[] = [];
  for (const e of existing) {
    const reasons: string[] = [];
    let score = 0;
    const nameSim = name && e.normalizedName ? similarity(name, e.normalizedName) : 0;
    if (nameSim >= 0.99) {
      score += 0.5;
      reasons.push("Same business name");
    } else if (nameSim >= 0.8) {
      score += 0.35;
      reasons.push("Very similar business name");
    }
    if (phone.length >= 7 && e.normalizedPhone && phone === e.normalizedPhone) {
      score += 0.5;
      reasons.push("Same phone number");
    }
    if (addr && e.normalizedAddress) {
      const a = similarity(addr, e.normalizedAddress);
      if (a >= 0.95) {
        score += 0.45;
        reasons.push("Same address");
      } else if (a >= 0.85) {
        score += 0.25;
        reasons.push("Similar address");
      }
    }
    if (email && e.email && email === e.email.toLowerCase()) {
      score += 0.4;
      reasons.push("Same email");
    }
    if (score >= threshold || (reasons.length >= 1 && score >= 0.5)) out.push({ id: e.id, score: Math.min(1, score), reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}
