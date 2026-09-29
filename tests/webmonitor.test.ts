import { describe, it, expect, beforeEach } from "vitest";
import { politeFetch, clearRobotsCache, type FetchFn } from "@/lib/web/fetcher";
import { isBlockedHost, isPrivateAddress, looksLikeLoginWall, looksLikeChallenge } from "@/lib/web/policy";
import { parseFeed, parseHtml, extractFindings, detectDeadline, detectRegions, detectPlatform } from "@/lib/web/extract";

const publicLookup = async () => [{ address: "93.184.216.34" }];

/** Build a fake web: map of URL -> response. */
function fakeWeb(pages: Record<string, { status?: number; body?: string; type?: string; location?: string }>) {
  const calls: string[] = [];
  const fn: FetchFn = async (url) => {
    calls.push(url);
    const p = pages[url];
    if (!p) return new Response("not found", { status: 404 });
    const headers: Record<string, string> = { "content-type": p.type ?? "text/html" };
    if (p.location) headers.location = p.location;
    return new Response(p.body ?? "", { status: p.status ?? 200, headers });
  };
  return { fn, calls };
}

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>Now casting: Chicago indie feature seeks lead actress</title><link>https://news.example.org/a</link><description>SAG-AFTRA project shooting in Chicago. Submission deadline: 10/15/2026. Netflix.</description><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Open call in Atlanta for commercial</title><link>https://news.example.org/b</link><description>Audition in Atlanta, GA</description></item>
<item><title>Restaurant review</title><link>https://news.example.org/c</link><description>Great pizza</description></item>
<item><title>Extras casting Chicago</title><link>https://news.example.org/d</link><description>background casting call</description></item>
</channel></rss>`;

describe("web monitor safety policy", () => {
  beforeEach(() => clearRobotsCache());

  it("never fetches Actors Access / Breakdown Express or their subdomains", async () => {
    expect(isBlockedHost("actorsaccess.com")).toBe(true);
    expect(isBlockedHost("www.actorsaccess.com")).toBe(true);
    expect(isBlockedHost("breakdownexpress.com")).toBe(true);
    expect(isBlockedHost("notactorsaccess.com")).toBe(false);
    const web = fakeWeb({});
    const r = await politeFetch("https://www.actorsaccess.com/projects", { fetch: web.fn, lookup: publicLookup });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("BLOCKED_DOMAIN");
    expect(web.calls).toHaveLength(0); // not even robots.txt
  });

  it("refuses redirects into a blocked domain", async () => {
    const web = fakeWeb({ "https://site.example.org/go": { status: 302, location: "https://actorsaccess.com/x" } });
    const r = await politeFetch("https://site.example.org/go", { fetch: web.fn, lookup: publicLookup });
    expect(r.ok === false && r.code).toBe("BLOCKED_DOMAIN");
    expect(web.calls.some((c) => c.includes("actorsaccess"))).toBe(false);
  });

  it("blocks private network addresses", async () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("192.168.1.5")).toBe(true);
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    const r = await politeFetch("https://intranet.example.org/", { fetch: fakeWeb({}).fn, lookup: async () => [{ address: "10.1.2.3" }] });
    expect(r.ok === false && r.code).toBe("PRIVATE_ADDRESS");
  });

  it("obeys robots.txt disallow rules", async () => {
    const web = fakeWeb({
      "https://site.example.org/robots.txt": { body: "User-agent: *\nDisallow: /casting", type: "text/plain" },
      "https://site.example.org/casting": { body: "<a href='/x'>Now casting lead role</a>" },
    });
    const r = await politeFetch("https://site.example.org/casting", { fetch: web.fn, lookup: publicLookup });
    expect(r.ok === false && r.code).toBe("ROBOTS_DISALLOWED");
    expect(web.calls).not.toContain("https://site.example.org/casting");
  });

  it("skips the page if robots.txt cannot be read (server error)", async () => {
    const web = fakeWeb({ "https://site.example.org/robots.txt": { status: 500 }, "https://site.example.org/p": { body: "ok" } });
    const r = await politeFetch("https://site.example.org/p", { fetch: web.fn, lookup: publicLookup });
    expect(r.ok === false && r.code).toBe("ROBOTS_UNAVAILABLE");
  });

  it("fetches when robots.txt is missing (404) and identifies itself", async () => {
    let ua = "";
    const fn: FetchFn = async (url, init) => {
      ua = new Headers(init.headers).get("user-agent") ?? "";
      if (url.endsWith("robots.txt")) return new Response("", { status: 404 });
      return new Response(RSS, { status: 200, headers: { "content-type": "application/rss+xml" } });
    };
    const r = await politeFetch("https://news.example.org/feed", { fetch: fn, lookup: publicLookup });
    expect(r.ok).toBe(true);
    expect(ua).toMatch(/StewartBlindSpot/);
  });

  it("stops at logins, 401/403 and CAPTCHAs", async () => {
    const login = `<form><h1>Member login</h1><input type="password" name="pw"></form>`;
    expect(looksLikeLoginWall(login)).toBe(true);
    expect(looksLikeChallenge(`<div class="g-recaptcha"></div>`)).toBe(true);
    const web = fakeWeb({
      "https://a.example.org/p": { body: login },
      "https://b.example.org/p": { status: 403 },
      "https://c.example.org/p": { body: "<title>Attention Required! | Cloudflare</title>" },
    });
    for (const [u, code] of [["https://a.example.org/p", "LOGIN_REQUIRED"], ["https://b.example.org/p", "LOGIN_REQUIRED"], ["https://c.example.org/p", "CHALLENGE"]] as const) {
      const r = await politeFetch(u, { fetch: web.fn, lookup: publicLookup });
      expect(r.ok === false && r.code).toBe(code);
    }
  });

  it("rejects non-http URLs and URLs with credentials", async () => {
    expect((await politeFetch("ftp://x.org/a", { fetch: fakeWeb({}).fn, lookup: publicLookup })).ok).toBe(false);
    const r = await politeFetch("https://user:pass@x.example.org/a", { fetch: fakeWeb({}).fn, lookup: publicLookup });
    expect(r.ok === false && r.code).toBe("INVALID_URL");
  });
});

describe("web monitor extraction", () => {
  it("parses RSS and Atom", () => {
    expect(parseFeed(RSS, "https://news.example.org/feed")).toHaveLength(4);
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Casting call NYC</title><link href="https://x.org/1"/><summary>Audition</summary><updated>2026-09-20T00:00:00Z</updated></entry></feed>`;
    const items = parseFeed(atom, "https://x.org");
    expect(items[0].link).toBe("https://x.org/1");
    expect(items[0].published?.toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("parses HTML pages with and without a selector", () => {
    const html = `<html><body><nav><a href="/login">Now casting login</a></nav>
      <article><h2>Now casting: Southside drama</h2><a href="/p/1">More</a><p>Chicago. Deadline: Oct 12, 2026</p></article>
      <article><h2>Bake sale</h2><a href="/p/2">More</a></article></body></html>`;
    const withSel = parseHtml(html, "https://x.org/news", "article");
    expect(withSel.map((i) => i.title)).toEqual(["Now casting: Southside drama", "Bake sale"]);
    expect(withSel[0].link).toBe("https://x.org/p/1");
    const noSel = parseHtml(html, "https://x.org/news");
    expect(noSel.some((i) => i.title.includes("login"))).toBe(false); // nav removed
  });

  it("filters by keywords, excluded words and region", () => {
    const f = extractFindings(RSS, { kind: "RSS", baseUrl: "https://news.example.org/feed", keywords: ["casting", "audition", "open call"], excludeKeywords: ["extras", "background"], region: "CHICAGO" });
    expect(f.map((x) => x.url)).toEqual(["https://news.example.org/a"]); // Atlanta item and extras item dropped
    expect(f[0].region).toBe("CHICAGO");
    expect(f[0].detectedDeadline?.toISOString().slice(0, 10)).toBe("2026-10-15");
    expect(f[0].detectedPlatform).toBe("Netflix");
  });

  it("detects labelled deadlines only", () => {
    expect(detectDeadline("Submit by Oct 5, 2026")?.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(detectDeadline("Filming Oct 5, 2026")).toBeNull();
  });

  it("detects regions and platforms from text", () => {
    expect(detectRegions("Shooting in Atlanta, GA")).toEqual(["ATLANTA"]);
    expect(detectRegions("Self-tape from anywhere, nationwide")).toContain("NATIONWIDE");
    expect(detectPlatform("new Paramount+ series")).toBe("Paramount+");
    expect(detectPlatform("maximum effort")).toBeNull();
  });
});

describe("web monitor network errors", () => {
  it("reports an unreachable site as a network error, not a robots problem", async () => {
    clearRobotsCache();
    const r = await politeFetch("https://down.example.org/feed", { fetch: async () => { throw new Error("ECONNREFUSED"); }, lookup: publicLookup });
    expect(r.ok === false && r.code).toBe("NETWORK");
  });
});
