/**
 * Web monitor safety policy.
 *
 * The monitor only reads public pages/feeds the user has chosen and confirmed are allowed.
 * These rules are enforced in code and cannot be switched off from the UI:
 *  - Never contacts Actors Access / Breakdown Express / Breakdown Services or other
 *    account-based casting platforms.
 *  - Obeys robots.txt; if robots.txt can't be read (other than "not found"), the page is skipped.
 *  - Sends no cookies, no credentials, and identifies itself with an honest User-Agent.
 *  - Stops on login walls, 401/403 and CAPTCHA/bot challenges — never tries to get past them.
 *  - One page request per source per check, with a minimum interval between checks.
 */

export const USER_AGENT = "StewartBlindSpot/1.0 (personal casting research; respects robots.txt)";
export const ROBOTS_AGENT = "StewartBlindSpot";

/** Domains the monitor will never fetch, including subdomains. */
export const BLOCKED_DOMAINS = [
  "actorsaccess.com",
  "breakdownexpress.com",
  "breakdownservices.com",
  "castingnetworks.com",
  "castingfrontier.com",
  "backstage.com",
  "castittalent.com",
  "ecocast.com",
];

export const BLOCKED_REASON =
  "This site is an account-based casting platform. The web monitor never collects data from it — add listings you can see there manually or by import.";

export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return BLOCKED_DOMAINS.some((d) => h === d || h.endsWith("." + d));
}

/** Private, loopback, link-local and other non-public addresses (SSRF guard). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::" || v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  const m4 = v.replace(/^::ffff:/, "").match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m4) return false;
  const [a, b] = [Number(m4[1]), Number(m4[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Detect pages that require signing in. */
export function looksLikeLoginWall(html: string): boolean {
  const s = html.slice(0, 200_000).toLowerCase();
  const passwordField = /<input[^>]+type=["']?password/.test(s);
  const loginWords = /(sign in|log in|login|member login|create an account)/.test(s);
  return passwordField && loginWords;
}

/** Detect CAPTCHA / bot-challenge pages. */
export function looksLikeChallenge(html: string): boolean {
  const s = html.slice(0, 200_000).toLowerCase();
  return /(g-recaptcha|hcaptcha|cf-challenge|cf_chl_|captcha-container|are you a robot|verify you are human|attention required! \| cloudflare|turnstile)/.test(s);
}

export const MIN_INTERVAL_MINUTES = 60;
export const MANUAL_CHECK_COOLDOWN_MINUTES = 10;
