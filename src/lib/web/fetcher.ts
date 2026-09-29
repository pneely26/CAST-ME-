import robotsParser from "robots-parser";
import { lookup as dnsLookup } from "node:dns/promises";
import { BLOCKED_REASON, ROBOTS_AGENT, USER_AGENT, isBlockedHost, isPrivateAddress, looksLikeChallenge, looksLikeLoginWall } from "./policy";

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
export type LookupFn = (host: string) => Promise<{ address: string }[]>;

export interface FetchDeps {
  fetch?: FetchFn;
  lookup?: LookupFn;
  timeoutMs?: number;
  maxBytes?: number;
}

export type FetchOutcome =
  | { ok: true; url: string; status: number; contentType: string; body: string }
  | { ok: false; code: "INVALID_URL" | "BLOCKED_DOMAIN" | "PRIVATE_ADDRESS" | "ROBOTS_DISALLOWED" | "ROBOTS_UNAVAILABLE" | "LOGIN_REQUIRED" | "CHALLENGE" | "HTTP_ERROR" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "NETWORK"; message: string };

const defaultLookup: LookupFn = async (host) => dnsLookup(host, { all: true });

async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

async function checkHost(u: URL, lookup: LookupFn): Promise<FetchOutcome | null> {
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, code: "INVALID_URL", message: "Only http(s) URLs are allowed." };
  if (u.username || u.password) return { ok: false, code: "INVALID_URL", message: "URLs with credentials are not allowed." };
  if (isBlockedHost(u.hostname)) return { ok: false, code: "BLOCKED_DOMAIN", message: BLOCKED_REASON };
  try {
    const addrs = await lookup(u.hostname);
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
      return { ok: false, code: "PRIVATE_ADDRESS", message: "Address is not a public website." };
    }
  } catch {
    return { ok: false, code: "NETWORK", message: `Could not resolve ${u.hostname}.` };
  }
  return null;
}

const robotsCache = new Map<string, { at: number; allowed: (url: string) => boolean | "unavailable" }>();

type RobotsCheck = (url: string) => boolean | "unavailable";

async function robotsAllows(u: URL, doFetch: FetchFn, timeoutMs: number): Promise<true | FetchOutcome> {
  const origin = u.origin;
  const cached = robotsCache.get(origin);
  let check: RobotsCheck | null = cached && Date.now() - cached.at < 3_600_000 ? cached.allowed : null;
  if (!check) {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const res = await doFetch(robotsUrl, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs), credentials: "omit" });
      if (res.status === 404 || res.status === 410) check = () => true;
      else if (res.ok) {
        const robots = robotsParser(robotsUrl, (await res.text()).slice(0, 500_000));
        check = (url) => robots.isAllowed(url, ROBOTS_AGENT) !== false;
      } else check = () => "unavailable";
    } catch (e) {
      // Site unreachable: report it, and don't cache so the next scheduled check tries again.
      return { ok: false, code: "NETWORK", message: `Could not reach ${u.hostname} (${(e as Error).message}). Will try again at the next scheduled check.` };
    }
    robotsCache.set(origin, { at: Date.now(), allowed: check });
  }
  const r = check(u.toString());
  if (r === "unavailable") return { ok: false, code: "ROBOTS_UNAVAILABLE", message: "robots.txt could not be read, so the page was not fetched." };
  if (!r) return { ok: false, code: "ROBOTS_DISALLOWED", message: "The site's robots.txt does not allow automated access to this page." };
  return true;
}

export function clearRobotsCache() {
  robotsCache.clear();
}

/**
 * Fetch one public page politely. Enforces the policy in ./policy.ts on the initial URL
 * and on every redirect hop.
 */
export async function politeFetch(rawUrl: string, deps: FetchDeps = {}): Promise<FetchOutcome> {
  const doFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const lookup = deps.lookup ?? defaultLookup;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const maxBytes = deps.maxBytes ?? 2_000_000;

  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "Invalid URL." };
  }

  for (let hop = 0; hop <= 3; hop++) {
    const hostProblem = await checkHost(u, lookup);
    if (hostProblem) return hostProblem;
    const robots = await robotsAllows(u, doFetch, timeoutMs);
    if (robots !== true) return robots;

    let res: Response;
    try {
      res = await doFetch(u.toString(), {
        headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9" },
        redirect: "manual",
        credentials: "omit",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return { ok: false, code: "NETWORK", message: `Request failed: ${(e as Error).message}` };
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      u = new URL(res.headers.get("location")!, u);
      continue;
    }
    if (res.status === 401 || res.status === 403) return { ok: false, code: "LOGIN_REQUIRED", message: `The site refused access (HTTP ${res.status}). Not retried.` };
    if (res.status === 429) return { ok: false, code: "HTTP_ERROR", message: "The site asked us to slow down (HTTP 429). Will wait until the next scheduled check." };
    if (!res.ok) return { ok: false, code: "HTTP_ERROR", message: `HTTP ${res.status}` };

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && !/(html|xml|rss|atom|text\/plain)/.test(contentType)) {
      return { ok: false, code: "UNSUPPORTED_TYPE", message: `Unsupported content type: ${contentType}` };
    }
    const body = await readCapped(res, maxBytes);
    if (body === null) return { ok: false, code: "TOO_LARGE", message: "Page is larger than 2 MB." };
    if (looksLikeChallenge(body)) return { ok: false, code: "CHALLENGE", message: "The site showed a CAPTCHA / bot check. The monitor does not bypass these — source skipped." };
    if (looksLikeLoginWall(body)) return { ok: false, code: "LOGIN_REQUIRED", message: "This page requires signing in. The monitor only reads public pages." };
    return { ok: true, url: u.toString(), status: res.status, contentType, body };
  }
  return { ok: false, code: "HTTP_ERROR", message: "Too many redirects." };
}
