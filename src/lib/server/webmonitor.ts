import type { WebSource } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { politeFetch, type FetchDeps } from "../web/fetcher";
import { extractFindings, filterItems, type Finding } from "../web/extract";
import { activeSearchProvider, SearchError } from "../web/search";
import { MANUAL_CHECK_COOLDOWN_MINUTES, MIN_INTERVAL_MINUTES, isBlockedHost, BLOCKED_REASON } from "../web/policy";
import { emitAlert } from "../alerts/engine";
import { createBreakdown } from "./records";
import { updateBreakdownRelevance } from "./profile";
import { rerunUnreviewed } from "./detection";
import { REGION_LABELS } from "../constants";

export interface CheckResult {
  sourceId: string;
  ok: boolean;
  skipped?: string;
  message: string;
  newFindings: number;
}

/** Is this source allowed to run at all? */
export function sourceRunnable(s: Pick<WebSource, "enabled" | "termsConfirmed" | "url" | "kind">): string | null {
  if (!s.termsConfirmed) return "Terms not confirmed";
  if (!s.enabled) return "Disabled";
  if (s.kind === "SEARCH") return activeSearchProvider() ? null : "No search API key configured (see Settings → Web search)";
  try {
    if (isBlockedHost(new URL(s.url).hostname)) return BLOCKED_REASON;
  } catch {
    return "Invalid URL";
  }
  return null;
}

/**
 * Check one source. Scheduled runs respect the source's interval; manual "check now"
 * still enforces a short cooldown so a site is never hammered.
 */
export async function checkSource(sourceId: string, opts: { manual?: boolean; now?: Date; deps?: FetchDeps } = {}): Promise<CheckResult> {
  const now = opts.now ?? new Date();
  const s = await prisma.webSource.findUniqueOrThrow({ where: { id: sourceId } });
  const blocked = sourceRunnable(s);
  if (blocked) return { sourceId, ok: false, skipped: blocked, message: blocked, newFindings: 0 };

  const minutes = opts.manual ? MANUAL_CHECK_COOLDOWN_MINUTES : Math.max(s.minIntervalMinutes, MIN_INTERVAL_MINUTES);
  if (s.lastCheckedAt && now.getTime() - s.lastCheckedAt.getTime() < minutes * 60_000) {
    const msg = `Checked ${Math.round((now.getTime() - s.lastCheckedAt.getTime()) / 60_000)} min ago — waiting at least ${minutes} min between checks.`;
    return { sourceId, ok: true, skipped: msg, message: msg, newFindings: 0 };
  }

  let findings: Finding[];
  if (s.kind === "SEARCH") {
    const provider = activeSearchProvider()!;
    try {
      const items = await provider.search(s.query ?? "", { fetch: opts.deps?.fetch, freshnessDays: 14 });
      findings = filterItems(items, { baseUrl: s.url, keywords: s.keywords, excludeKeywords: s.excludeKeywords, region: s.region, keywordsOptional: true });
    } catch (e) {
      const message = e instanceof SearchError ? e.message : `Search failed: ${(e as Error).message}`;
      await prisma.webSource.update({ where: { id: s.id }, data: { lastCheckedAt: now, lastStatus: "SEARCH_ERROR", lastMessage: message } });
      return { sourceId, ok: false, message, newFindings: 0 };
    }
  } else {
    const res = await politeFetch(s.url, opts.deps);
    if (!res.ok) {
      await prisma.webSource.update({
        where: { id: s.id },
        data: {
          lastCheckedAt: now,
          lastStatus: res.code,
          lastMessage: res.message,
          // Hard stops: pause the source so it isn't retried automatically.
          ...(["BLOCKED_DOMAIN", "ROBOTS_DISALLOWED", "LOGIN_REQUIRED", "CHALLENGE"].includes(res.code) ? { enabled: false } : {}),
        },
      });
      return { sourceId, ok: false, message: res.message, newFindings: 0 };
    }
    findings = extractFindings(res.body, {
      kind: s.kind as "RSS" | "HTML",
      baseUrl: res.url,
      selector: s.itemSelector,
      keywords: s.keywords,
      excludeKeywords: s.excludeKeywords,
      region: s.region,
    });
  }

  let created = 0;
  for (const f of findings) {
    const exists = await prisma.webFinding.findUnique({ where: { sourceId_key: { sourceId: s.id, key: f.key } } });
    if (exists) continue;
    const saved = await prisma.webFinding.create({
      data: {
        sourceId: s.id,
        key: f.key,
        url: f.url,
        title: f.title,
        snippet: f.snippet,
        publishedAt: f.publishedAt,
        region: f.region,
        detectedDeadline: f.detectedDeadline,
        detectedPlatform: f.detectedPlatform ?? s.platform,
        matchedKeywords: f.matchedKeywords,
        discoveredAt: now,
      },
    });
    created++;
    await emitAlert({
      type: "NEW_MATCH",
      title: `Web monitor: ${f.title.slice(0, 120)}`,
      body: `${s.name}${f.region ? ` · ${REGION_LABELS[f.region]}` : ""} · matched “${f.matchedKeywords.slice(0, 3).join("”, “")}”. Unverified — review before relying on it.`,
      link: `/web-monitor?finding=${saved.id}`,
      dedupeKey: `WEB:${saved.id}`,
    });
  }

  await prisma.webSource.update({
    where: { id: s.id },
    data: { lastCheckedAt: now, lastStatus: "OK", lastMessage: `${findings.length} matching listing(s)${s.kind === "SEARCH" ? " in search results" : " on page"}, ${created} new.` },
  });
  if (created > 0) {
    await audit("IMPORT", "WebFinding", s.id, `Web monitor found ${created} new listing(s) on ${s.name}`, { source: s.url });
  }
  return { sourceId, ok: true, message: `${created} new`, newFindings: created };
}

/** Run every enabled, confirmed source that is due. Sources are checked one at a time. */
export async function runWebSources(now = new Date(), deps?: FetchDeps) {
  const sources = await prisma.webSource.findMany({ where: { enabled: true, termsConfirmed: true } });
  const results: CheckResult[] = [];
  for (const s of sources) {
    try {
      results.push(await checkSource(s.id, { now, deps }));
    } catch (e) {
      results.push({ sourceId: s.id, ok: false, message: (e as Error).message, newFindings: 0 });
    }
  }
  return results;
}

/** Turn a finding into a public breakdown (UNVERIFIED) — only when the user chooses to. */
export async function acceptFinding(findingId: string, overrides: { project?: string; roleName?: string } = {}) {
  const f = await prisma.webFinding.findUniqueOrThrow({ where: { id: findingId }, include: { source: true } });
  if (f.status === "ACCEPTED" && f.breakdownId) return f.breakdownId;
  const b = await createBreakdown({
    project: overrides.project?.trim() || f.title,
    roleName: overrides.roleName?.trim() || null,
    platform: f.detectedPlatform,
    region: f.region,
    characterDescription: f.snippet,
    postedDate: f.publishedAt,
    submissionDeadline: f.detectedDeadline,
    visibility: "PUBLIC",
    source: `Web monitor: ${f.source.name}`,
    sourceUrl: f.url,
    verified: false,
  });
  await prisma.webFinding.update({ where: { id: f.id }, data: { status: "ACCEPTED", breakdownId: b.id } });
  await updateBreakdownRelevance([b.id]);
  await rerunUnreviewed();
  await audit("CREATE", "PublicBreakdown", b.id, `Added from web monitor: ${f.title}`, { source: f.source.url, url: f.url });
  return b.id;
}
