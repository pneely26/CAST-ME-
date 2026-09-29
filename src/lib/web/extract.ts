import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { DEFAULT_PLATFORMS, type RegionCode } from "../constants";
import { parseDate } from "../import/parse";

export interface RawItem {
  title: string;
  link: string;
  summary: string;
  published: Date | null;
}

export const DEFAULT_KEYWORDS = ["casting", "audition", "now casting", "open call", "seeking actors", "seeking talent", "breakdown", "self-tape", "self tape"];

function clean(s: unknown, max = 2000): string {
  return String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function absolutize(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** Parse RSS 2.0 or Atom. */
export function parseFeed(xml: string, baseUrl: string): RawItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: true, htmlEntities: true });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const text = (v: unknown): string => (typeof v === "object" && v !== null ? String((v as Record<string, unknown>)["#text"] ?? "") : String(v ?? ""));
  const rss = (doc.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  if (rss) {
    return asArray(rss.item as Record<string, unknown>[]).map((it) => ({
      title: clean(text(it.title), 300),
      link: absolutize(text(it.link) || text(it.guid), baseUrl) ?? baseUrl,
      summary: clean(text(it.description) || text(it["content:encoded"])),
      published: it.pubDate ? safeDate(text(it.pubDate)) : null,
    }));
  }
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    return asArray(feed.entry as Record<string, unknown>[]).map((e) => {
      const links = asArray(e.link as Record<string, string>[]);
      const href = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate")?.["@_href"] ?? links[0]?.["@_href"] ?? "";
      return {
        title: clean(text(e.title), 300),
        link: absolutize(href, baseUrl) ?? baseUrl,
        summary: clean(text(e.summary) || text(e.content)),
        published: safeDate(text(e.published) || text(e.updated)),
      };
    });
  }
  return [];
}

function safeDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse an HTML page. With a selector, each matching element is one listing.
 * Without one, every link is a candidate listing (filtered later by keywords).
 */
export function parseHtml(html: string, baseUrl: string, selector?: string | null): RawItem[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header form").remove();
  const items: RawItem[] = [];
  if (selector) {
    let els;
    try {
      els = $(selector);
    } catch {
      return [];
    }
    els.slice(0, 200).each((_, el) => {
      const node = $(el);
      const heading = node.find("h1, h2, h3, h4, a").first();
      const title = clean(heading.text() || node.text(), 300);
      const href = node.is("a") ? node.attr("href") : node.find("a[href]").first().attr("href");
      if (title.length < 4) return;
      items.push({ title, link: (href && absolutize(href, baseUrl)) || baseUrl, summary: clean(node.text()), published: null });
    });
    return items;
  }
  $("a[href]").slice(0, 500).each((_, el) => {
    const a = $(el);
    const title = clean(a.text(), 300);
    if (title.length < 8) return;
    const link = absolutize(a.attr("href") ?? "", baseUrl);
    if (!link) return;
    const container = a.closest("article, li, tr, p, div");
    items.push({ title, link, summary: clean(container.text() || title), published: null });
  });
  return items;
}

const REGION_PATTERNS: [RegionCode, RegExp][] = [
  ["CHICAGO", /\bchicago\b|\bchi-?town\b|\billinois\b|,\s*il\b/i],
  ["NEW_YORK", /\bnew york\b|\bnyc\b|\bbrooklyn\b|\bmanhattan\b|,\s*ny\b/i],
  ["LOS_ANGELES", /\blos angeles\b|\bhollywood\b|\bl\.a\.|,\s*ca\b|\bburbank\b/i],
  ["ATLANTA", /\batlanta\b|\bgeorgia\b|,\s*ga\b/i],
  ["SOUTHEAST", /\bsoutheast\b|\bnashville\b|\bcharlotte\b|\bnew orleans\b|\bwilmington\b|\bsavannah\b|\bmiami\b/i],
  ["NATIONWIDE", /\bnationwide\b|\bnational(ly)?\b|\bself[- ]?tape (from )?anywhere\b|\bus[- ]based\b/i],
];

export function detectRegions(text: string): RegionCode[] {
  return REGION_PATTERNS.filter(([, re]) => re.test(text)).map(([r]) => r);
}

/** Only dates that are explicitly labelled as a deadline. */
export function detectDeadline(text: string): Date | null {
  const m = text.match(/(?:deadline|submit(?:ted)? by|submissions? (?:due|close[sd]?)|due(?: date)?|apply by)\s*[:\-–]?\s*([A-Za-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\d{4}-\d{2}-\d{2})/i);
  if (!m) return null;
  let raw = m[1].replace(/(\d)(st|nd|rd|th)/, "$1").replace(".", "");
  if (/^[A-Za-z]/.test(raw) && !/\d{4}/.test(raw)) raw += ` ${new Date().getUTCFullYear()}`;
  if (/^\d{1,2}[/.-]\d{1,2}$/.test(raw)) raw += `/${new Date().getUTCFullYear()}`;
  return parseDate(raw);
}

export function detectPlatform(text: string): string | null {
  const candidates = DEFAULT_PLATFORMS.filter((p) => !["Other", "Max", "FOX", "ABC", "FX"].includes(p));
  for (const p of candidates) {
    const re = new RegExp(`(^|[^A-Za-z])${p.replace(/[+]/g, "\\+").replace(/ /g, "\\s+")}([^A-Za-z]|$)`, "i");
    if (re.test(text)) return p;
  }
  for (const p of ["FOX", "ABC", "FX"]) if (new RegExp(`\\b${p}\\b`).test(text)) return p; // case-sensitive for short names
  return null;
}

export function matchKeywords(text: string, keywords: string[], exclude: string[]): { matched: string[]; excluded: boolean } {
  const t = text.toLowerCase();
  const matched = keywords.filter((k) => k.trim() && t.includes(k.trim().toLowerCase()));
  const excluded = exclude.some((k) => k.trim() && t.includes(k.trim().toLowerCase()));
  return { matched, excluded };
}

export interface Finding {
  key: string;
  url: string;
  title: string;
  snippet: string;
  publishedAt: Date | null;
  region: RegionCode | null;
  detectedDeadline: Date | null;
  detectedPlatform: string | null;
  matchedKeywords: string[];
}

export interface ExtractOptions {
  kind: "RSS" | "HTML";
  baseUrl: string;
  selector?: string | null;
  keywords: string[];
  excludeKeywords: string[];
  /** The region the user is monitoring with this source. If set, only listings for it (or nationwide/unspecified) are kept. */
  region?: RegionCode | null;
}

/** Turn a fetched page/feed into filtered, de-duplicated findings. */
export function extractFindings(body: string, opts: ExtractOptions): Finding[] {
  const items = opts.kind === "RSS" ? parseFeed(body, opts.baseUrl) : parseHtml(body, opts.baseUrl, opts.selector);
  const keywords = opts.keywords.length ? opts.keywords : DEFAULT_KEYWORDS;
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const it of items) {
    if (!it.title) continue;
    const text = `${it.title} ${it.summary}`;
    const { matched, excluded } = matchKeywords(text, keywords, opts.excludeKeywords);
    if (excluded || matched.length === 0) continue;
    const regions = detectRegions(text);
    if (opts.region && opts.region !== "NATIONWIDE" && regions.length > 0 && !regions.includes(opts.region) && !regions.includes("NATIONWIDE")) continue;
    const key = it.link === opts.baseUrl ? `${it.link}#${it.title.toLowerCase().slice(0, 120)}` : it.link;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      url: it.link,
      title: it.title,
      snippet: it.summary.slice(0, 1000),
      publishedAt: it.published,
      region: regions.includes(opts.region as RegionCode) ? (opts.region as RegionCode) : (regions[0] ?? opts.region ?? null),
      detectedDeadline: detectDeadline(text),
      detectedPlatform: detectPlatform(text),
      matchedKeywords: matched,
    });
  }
  return out.slice(0, 100);
}
