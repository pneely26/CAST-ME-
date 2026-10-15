/**
 * Web-wide search through official search APIs (keys you sign up for yourself).
 * Results are what the search engine returns — titles, links and snippets. The monitor
 * does not open the result pages, so a result may point anywhere the search engine indexes.
 */
import type { RawItem } from "./extract";
import type { FetchFn } from "./fetcher";

export interface SearchProvider {
  id: "brave" | "google";
  name: string;
  configured(): boolean;
  search(query: string, opts?: { fetch?: FetchFn; freshnessDays?: number }): Promise<RawItem[]>;
}

export class SearchError extends Error {}

const doFetch = (f?: FetchFn): FetchFn => f ?? ((url, init) => fetch(url, init));

export const braveSearch: SearchProvider = {
  id: "brave",
  name: "Brave Search API",
  configured: () => Boolean(process.env.BRAVE_SEARCH_API_KEY),
  async search(query, opts = {}) {
    const days = opts.freshnessDays ?? 7;
    const freshness = days <= 1 ? "pd" : days <= 7 ? "pw" : days <= 31 ? "pm" : "py";
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20&freshness=${freshness}&country=us&safesearch=moderate`;
    const res = await doFetch(opts.fetch)(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY ?? "" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401 || res.status === 403) throw new SearchError("Brave Search rejected the API key.");
    if (res.status === 429) throw new SearchError("Brave Search rate limit or monthly quota reached.");
    if (!res.ok) throw new SearchError(`Brave Search error (HTTP ${res.status}).`);
    const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string; page_age?: string; age?: string }[] } };
    return (data.web?.results ?? []).map((r) => ({
      title: strip(r.title),
      link: r.url ?? "",
      summary: strip(r.description),
      published: r.page_age ? safeDate(r.page_age) : null,
    }));
  },
};

export const googleSearch: SearchProvider = {
  id: "google",
  name: "Google Programmable Search (Custom Search JSON API)",
  configured: () => Boolean(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID),
  async search(query, opts = {}) {
    const days = opts.freshnessDays ?? 7;
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(process.env.GOOGLE_CSE_KEY ?? "")}&cx=${encodeURIComponent(process.env.GOOGLE_CSE_ID ?? "")}&q=${encodeURIComponent(query)}&num=10&dateRestrict=d${days}`;
    const res = await doFetch(opts.fetch)(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 400 || res.status === 403) throw new SearchError("Google search rejected the key/search engine ID, or the daily quota is used up.");
    if (res.status === 429) throw new SearchError("Google search quota reached.");
    if (!res.ok) throw new SearchError(`Google search error (HTTP ${res.status}).`);
    const data = (await res.json()) as { items?: { title?: string; link?: string; snippet?: string }[] };
    return (data.items ?? []).map((r) => ({ title: strip(r.title), link: r.link ?? "", summary: strip(r.snippet), published: null }));
  },
};

export const searchProviders: SearchProvider[] = [braveSearch, googleSearch];

/** The provider to use: SEARCH_PROVIDER if set and configured, else the first configured one. */
export function activeSearchProvider(): SearchProvider | null {
  const want = process.env.SEARCH_PROVIDER?.toLowerCase();
  const chosen = searchProviders.find((p) => p.id === want && p.configured());
  return chosen ?? searchProviders.find((p) => p.configured()) ?? null;
}

function strip(s?: string) {
  return (s ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

function safeDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Ready-made searches for a city/market. */
export function presetQueries(city: string): string[] {
  return [`"now casting" "${city}"`, `"casting call" "${city}" actors`, `"open auditions" "${city}"`];
}

/** Free Google News RSS search feed for a city (no API key). Checked through the polite fetcher. */
export function newsFeedUrl(city: string): string {
  const q = `("now casting" OR "casting call" OR "open call" OR auditions) "${city}" when:14d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}
