import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { getPlatforms } from "@/lib/server/profile";
import { acceptFindingAction, addSearchAction, addWebSourceAction, checkWebSourceAction, deleteWebSourceAction, dismissFindingAction, setupRegionSearchesAction, toggleWebSourceAction } from "@/app/actions/webmonitor";
import { activeSearchProvider, searchProviders } from "@/lib/web/search";
import { getProfile } from "@/lib/server/profile";
import { Badge, DeadlineBadge, Empty, Flash, PageHeader, Section } from "@/components/ui";
import { Field, FormSection, PlatformSelect, RegionSelect, TextArea } from "@/components/FormFields";
import { FilterBar, Select, regionOptions } from "@/components/Filters";
import { BLOCKED_DOMAINS } from "@/lib/web/policy";
import { DEFAULT_KEYWORDS } from "@/lib/web/extract";
import { REGION_LABELS, type RegionCode } from "@/lib/constants";
import { fmtDate, fmtDateTime, relativeDays } from "@/lib/format";
import { region, str, type SP } from "@/lib/server/filters";

export const metadata = { title: "Web Monitor" };

export default async function WebMonitorPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const now = new Date();
  const r = region(sp);
  const status = str(sp, "status") ?? "NEW";
  const where: Prisma.WebFindingWhereInput = {
    ...(["NEW", "ACCEPTED", "DISMISSED"].includes(status) ? { status: status as "NEW" } : {}),
    ...(r ? { region: r } : {}),
    ...(str(sp, "finding") ? { id: str(sp, "finding") } : {}),
  };
  const provider = activeSearchProvider();
  const [sources, findings, newCount, platforms, profile] = await Promise.all([
    prisma.webSource.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { findings: true } } } }),
    prisma.webFinding.findMany({ where, include: { source: true }, orderBy: { discoveredAt: "desc" }, take: 200 }),
    prisma.webFinding.count({ where: { status: "NEW" } }),
    getPlatforms(),
    getProfile(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Web Monitor"
        description="Searches the web and checks public casting pages and feeds — by region and keyword — and collects new listings here for you to review."
      />
      <Flash message={str(sp, "msg")} />
      <Flash message={str(sp, "error")} tone="bad" />

      <div className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-ink-soft">
        <strong className="text-ink">How it stays within your rules.</strong> Only public pages you add. It reads robots.txt and skips anything the site disallows,
        stops at logins and CAPTCHAs, sends no passwords or cookies, and checks each source at most every few hours. It will never contact{" "}
        {BLOCKED_DOMAINS.slice(0, 3).join(", ")} or other account-based casting platforms. Findings are marked <Badge tone="muted">Unverified</Badge> until you check them.
      </div>

      <Section title={`Findings${newCount ? ` — ${newCount} new` : ""}`} subtitle="Listings from your sources that matched your keywords and region." className="scroll-mt-4">
        <div className="border-b border-line px-3 pt-3">
          <FilterBar resetHref="/web-monitor" action="/web-monitor">
            <Select name="status" label="Status" value={status} any="All" options={[{ value: "NEW", label: "New" }, { value: "ACCEPTED", label: "Added" }, { value: "DISMISSED", label: "Dismissed" }]} />
            <Select name="region" label="Region" value={r} options={regionOptions} />
          </FilterBar>
        </div>
        {findings.length === 0 ? (
          <Empty>{sources.length === 0 ? "Add a source below to start monitoring." : "No findings here yet. New listings appear after each check."}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {findings.map((f) => (
              <li key={f.id} id={f.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <a href={f.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:underline">{f.title} ↗</a>
                    <div className="mt-0.5 text-xs text-muted">
                      {f.source.name} · found {relativeDays(f.discoveredAt, now)}{f.publishedAt ? ` · posted ${fmtDate(f.publishedAt)}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {f.region && <Badge tone="accent">{REGION_LABELS[f.region as RegionCode]}</Badge>}
                    {f.detectedPlatform && <Badge tone="neutral">{f.detectedPlatform}</Badge>}
                    {f.detectedDeadline && <DeadlineBadge deadline={f.detectedDeadline} now={now} />}
                    {f.status === "NEW" ? <Badge tone="muted">Unverified</Badge> : <Badge tone={f.status === "ACCEPTED" ? "good" : "neutral"}>{f.status === "ACCEPTED" ? "Added" : "Dismissed"}</Badge>}
                  </div>
                </div>
                {f.snippet && f.snippet !== f.title && <p className="mt-1.5 line-clamp-3 text-sm text-ink-soft">{f.snippet}</p>}
                <div className="mt-1 text-[11px] text-muted">Matched: {f.matchedKeywords.join(", ")}</div>
                {f.status === "NEW" && (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <form action={acceptFindingAction} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                      <input type="hidden" name="id" value={f.id} />
                      <label className="block flex-1"><span className="label">Project title</span><input name="project" defaultValue={f.title.slice(0, 300)} className="input" /></label>
                      <label className="block sm:w-48"><span className="label">Role (optional)</span><input name="roleName" className="input" /></label>
                      <button className="btn-primary whitespace-nowrap">Add as opportunity</button>
                    </form>
                    <form action={dismissFindingAction}><input type="hidden" name="id" value={f.id} /><button className="btn-ghost">Dismiss</button></form>
                  </div>
                )}
                {f.status === "ACCEPTED" && f.breakdownId && <a href={`/opportunities/${f.breakdownId}`} className="link mt-1 inline-block text-xs">Open opportunity</a>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Search the whole web" subtitle="Finds public casting calls on any site a search engine indexes — casting offices, productions, theatres, news, social posts." className="scroll-mt-4">
        <div id="search" className="grid gap-5 p-4 lg:grid-cols-2">
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Search API:</span>
              {provider ? <Badge tone="good">{provider.name}</Badge> : <Badge tone="muted">Not connected</Badge>}
            </div>
            {!provider && (
              <div className="rounded-md border border-line bg-paper p-3 text-xs text-ink-soft">
                To search the whole web, add a key to <code>.env</code> and restart. Either:
                <ul className="mt-1 list-disc pl-5">
                  <li><strong>Brave Search API</strong> (has a free plan): sign up at api-dashboard.search.brave.com → <code>BRAVE_SEARCH_API_KEY=&quot;…&quot;</code></li>
                  <li><strong>Google Programmable Search</strong>: <code>GOOGLE_CSE_KEY=&quot;…&quot;</code> and <code>GOOGLE_CSE_ID=&quot;…&quot;</code></li>
                </ul>
                The free news feeds below work without a key.
              </div>
            )}
            <form action={setupRegionSearchesAction} className="rounded-md border border-line p-3">
              <div className="font-medium">Set up my regions automatically</div>
              <p className="mt-1 text-xs text-muted">
                Adds a free Google News casting feed{provider ? " and two web searches" : ""} for each of your target markets: <strong>{profile.targetMarkets.join(", ") || "none set"}</strong> (edit them in Settings). Checked every 12 hours.
              </p>
              <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" name="confirm" value="yes" className="mt-0.5" /> OK to check these public feeds{provider ? " and use my search API quota" : ""} automatically</label>
              <button className="btn-primary mt-2">Set up region searches</button>
            </form>
          </div>
          <form action={addSearchAction} className="space-y-3 rounded-md border border-line p-3">
            <div className="text-sm font-medium">Add a custom web search</div>
            <label className="block"><span className="label">Search for</span><input name="query" className="input" placeholder={'"now casting" Chicago SAG-AFTRA'} required /></label>
            <div className="grid grid-cols-2 gap-2">
              <RegionSelect label="Region" />
              <label className="block"><span className="label">Check every (hours)</span><input name="intervalHours" type="number" min={1} max={168} defaultValue={12} className="input" /></label>
            </div>
            <label className="block"><span className="label">Exclude words</span><input name="excludeKeywords" className="input" placeholder="extras, unpaid" /></label>
            <button className="btn-secondary" disabled={!provider} title={provider ? "" : "Connect a search API first"}>Add search</button>
            {!provider && <p className="text-xs text-muted">Needs a search API key ({searchProviders.map((p) => p.name).join(" or ")}).</p>}
          </form>
        </div>
      </Section>

      <Section title="Sources" subtitle="Checked automatically when the monitor runs (npm run monitor / scheduled), or on demand." className="scroll-mt-4">
        <div id="sources" />
        {sources.length === 0 ? (
          <Empty>No sources yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <Badge tone={s.enabled ? "good" : "muted"}>{s.enabled ? "Active" : "Paused"}</Badge>
                    <Badge tone="neutral">{s.kind === "RSS" ? "Feed" : s.kind === "SEARCH" ? "Web search" : "Web page"}</Badge>
                    {s.region && <Badge tone="accent">{REGION_LABELS[s.region as RegionCode]}</Badge>}
                  </div>
                  {s.kind === "SEARCH" ? (
                    <div className="truncate text-xs text-ink-soft">Searching: {s.query}</div>
                  ) : (
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-xs text-accent hover:underline">{s.url}</a>
                  )}
                  <div className="text-xs text-muted">
                    Every {Math.round(s.minIntervalMinutes / 60)}h · keywords: {(s.keywords.length ? s.keywords : s.kind === "SEARCH" ? ["(search query)"] : DEFAULT_KEYWORDS).slice(0, 6).join(", ")}{s.excludeKeywords.length ? ` · excluding: ${s.excludeKeywords.join(", ")}` : ""} · {s._count.findings} finding(s)
                  </div>
                  <div className={`text-xs ${s.lastStatus && s.lastStatus !== "OK" ? "text-red-700" : "text-ink-soft"}`}>
                    {s.lastCheckedAt ? `Last checked ${fmtDateTime(s.lastCheckedAt)} — ${s.lastMessage ?? s.lastStatus}` : "Not checked yet"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={checkWebSourceAction}><input type="hidden" name="id" value={s.id} /><button className="btn-secondary" disabled={!s.enabled}>Check now</button></form>
                  <form action={toggleWebSourceAction}><input type="hidden" name="id" value={s.id} /><button className="btn-secondary">{s.enabled ? "Pause" : "Resume"}</button></form>
                  <form action={deleteWebSourceAction} className="flex items-center gap-1 text-xs">
                    <input type="hidden" name="id" value={s.id} />
                    <label className="flex items-center gap-1"><input type="checkbox" name="confirm" value="yes" /> delete</label>
                    <button className="btn-ghost text-red-700">Delete</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div id="add" className="scroll-mt-4">
        <h2 className="mb-3 text-lg font-semibold">Add a source</h2>
        <form action={addWebSourceAction} className="space-y-4">
          <FormSection title="Where to look">
            <Field label="Name" name="name" required placeholder="e.g. Chicago casting news (Google Alert)" />
            <label className="block">
              <span className="label">Type</span>
              <select name="kind" className="input" defaultValue="RSS">
                <option value="RSS">RSS / Atom feed (recommended)</option>
                <option value="HTML">Public web page</option>
              </select>
            </label>
            <Field label="URL" name="url" type="url" required placeholder="https://…" className="sm:col-span-2" />
            <RegionSelect label="Region to monitor" />
            <label className="block"><span className="label">Check every (hours)</span><input name="intervalHours" type="number" min={1} max={168} defaultValue={6} className="input" /></label>
            <div className="sm:col-span-2"><PlatformSelect platforms={platforms} /></div>
          </FormSection>
          <FormSection title="What to collect" note="A listing is kept when it contains at least one keyword and none of the excluded words. If a region is set, listings that name a different region are skipped.">
            <TextArea label="Keywords (comma-separated)" name="keywords" rows={2} defaultValue="casting, audition, seeking" hint={`Leave blank for defaults: ${DEFAULT_KEYWORDS.join(", ")}`} />
            <TextArea label="Exclude words" name="excludeKeywords" rows={2} defaultValue="" hint="e.g. extras, background, unpaid, student film" />
            <Field label="Listing CSS selector (web pages, optional)" name="itemSelector" placeholder="article, .post, li.listing" hint="Leave blank to scan all links on the page." />
          </FormSection>
          <FormSection title="Permission">
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="termsConfirmed" value="yes" className="mt-1" required />
              <span>I confirmed this page is public (no login needed) and the site’s terms allow automated checking for personal use. The monitor also obeys the site’s robots.txt.</span>
            </label>
            <TextArea label="Notes on the site's terms (optional)" name="termsNote" rows={2} className="sm:col-span-2" />
          </FormSection>
          <button className="btn-primary">Add source</button>
        </form>
      </div>

      <Section title="Good sources to add">
        <div className="space-y-3 p-4 text-sm text-ink-soft">
          <p>
            <strong className="text-ink">Google Alerts as a feed (easiest, works for any region).</strong> Go to google.com/alerts, create an alert such as{" "}
            <em>“now casting” Chicago</em> or <em>“casting call” Atlanta SAG-AFTRA</em>, open <em>Show options → Deliver to: RSS feed</em>, then copy the feed link here as an
            RSS source. Make one alert per region or project type.
          </p>
          <p><strong className="text-ink">Casting office and production websites</strong> that post public calls (news or “casting” pages), and their RSS feeds if they have one.</p>
          <p><strong className="text-ink">Theatre audition boards and local arts-council or film-office pages</strong> that publish open calls publicly.</p>
          <p>Check each site’s terms before adding it. If a site needs a login, shows a CAPTCHA, or its robots.txt disallows access, the monitor pauses that source and tells you why.</p>
        </div>
      </Section>
    </div>
  );
}
