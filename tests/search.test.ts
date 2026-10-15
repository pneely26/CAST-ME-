import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { braveSearch, googleSearch, activeSearchProvider, presetQueries, newsFeedUrl, SearchError } from "@/lib/web/search";
import { filterItems } from "@/lib/web/extract";

const env = { ...process.env };
beforeEach(() => {
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.GOOGLE_CSE_KEY;
  delete process.env.GOOGLE_CSE_ID;
  delete process.env.SEARCH_PROVIDER;
});
afterEach(() => {
  process.env = { ...env };
});

describe("web-wide search", () => {
  it("picks a configured provider", () => {
    expect(activeSearchProvider()).toBeNull();
    process.env.GOOGLE_CSE_KEY = "k";
    process.env.GOOGLE_CSE_ID = "cx";
    expect(activeSearchProvider()?.id).toBe("google");
    process.env.BRAVE_SEARCH_API_KEY = "b";
    expect(activeSearchProvider()?.id).toBe("brave");
    process.env.SEARCH_PROVIDER = "google";
    expect(activeSearchProvider()?.id).toBe("google");
  });

  it("calls Brave with the key header and maps results", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "secret";
    let seen: { url: string; key: string | null } | null = null;
    const items = await braveSearch.search('"now casting" "Chicago"', {
      fetch: async (url, init) => {
        seen = { url, key: new Headers(init.headers).get("x-subscription-token") };
        return Response.json({ web: { results: [{ title: "Now <strong>casting</strong> Chicago drama", url: "https://x.org/1", description: "Lead role, deadline: 11/02/2026" }] } });
      },
    });
    expect(seen!.key).toBe("secret");
    expect(seen!.url).toContain("q=%22now%20casting%22%20%22Chicago%22");
    expect(items[0]).toMatchObject({ title: "Now casting Chicago drama", link: "https://x.org/1" });
  });

  it("calls Google and reports quota/key errors clearly", async () => {
    process.env.GOOGLE_CSE_KEY = "k";
    process.env.GOOGLE_CSE_ID = "cx";
    const items = await googleSearch.search("casting call Atlanta", { fetch: async () => Response.json({ items: [{ title: "Casting call", link: "https://y.org", snippet: "Atlanta, GA" }] }) });
    expect(items).toHaveLength(1);
    await expect(googleSearch.search("x", { fetch: async () => new Response("", { status: 403 }) })).rejects.toBeInstanceOf(SearchError);
  });

  it("filters search results by region without requiring keywords", () => {
    const f = filterItems(
      [
        { title: "Casting call in Chicago", link: "https://a.org", summary: "SAG-AFTRA. Deadline: Nov 2, 2026", published: null },
        { title: "Casting call in Atlanta, GA", link: "https://b.org", summary: "", published: null },
        { title: "Background extras needed Chicago", link: "https://c.org", summary: "", published: null },
      ],
      { baseUrl: "search:x", keywords: [], excludeKeywords: ["extras"], region: "CHICAGO", keywordsOptional: true },
    );
    expect(f.map((x) => x.url)).toEqual(["https://a.org"]);
    expect(f[0].detectedDeadline?.toISOString().slice(0, 10)).toBe("2026-11-02");
  });

  it("builds region presets", () => {
    expect(presetQueries("Chicago")[0]).toBe('"now casting" "Chicago"');
    expect(newsFeedUrl("New York")).toMatch(/^https:\/\/news\.google\.com\/rss\/search\?q=/);
  });
});
