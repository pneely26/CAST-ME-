import Link from "next/link";
import type { Prisma, BlindSpotClassification } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { ClassificationBadge, DemoBadge, Empty, PageHeader, RelevanceBadge, ReviewBadge, Section, DeadlineBadge } from "@/components/ui";
import { FilterBar, Select, TextFilter, regionOptions } from "@/components/Filters";
import { breakdownWhere, day, region, str, type SP } from "@/lib/server/filters";
import { getPlatforms } from "@/lib/server/profile";
import { CLASSIFICATIONS, PRODUCTION_TYPES, REGIONS, REGION_LABELS, humanize, parseRegion, type RegionCode } from "@/lib/constants";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Search" };

const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = str(sp, "q");
  const r = region(sp);
  const platform = str(sp, "platform");
  const union = str(sp, "union");
  const pt = str(sp, "productionType");
  const cd = str(sp, "cd");
  const source = str(sp, "source");
  const rel = str(sp, "relevance");
  const bs = str(sp, "blindSpot");
  const from = day(sp, "from");
  const to = day(sp, "to");
  const toEnd = to ? new Date(to.getTime() + 86_399_999) : undefined;
  const hasQuery = Boolean(q || r || platform || union || pt || cd || source || rel || bs || from || to);
  // A free-text query that names a region ("Chicago") also matches region fields.
  const qRegion = q ? (REGIONS as readonly string[]).find((x) => x === parseRegion(q) && x !== "OTHER") as RegionCode | undefined : undefined;

  const showPublic = source !== "agency";
  const showAgency = source !== "public";
  const platforms = await getPlatforms();

  let projects: Prisma.ProjectGetPayload<{ include: { _count: { select: { breakdowns: true; submissions: true } } } }>[] = [];
  let cds: Prisma.CastingDirectorGetPayload<object>[] = [];
  let breakdowns: Prisma.PublicBreakdownGetPayload<{ include: { project: true } }>[] = [];
  let submissions: Prisma.AgencySubmissionGetPayload<{ include: { blindSpot: true } }>[] = [];

  if (hasQuery) {
    const pAnd: Prisma.ProjectWhereInput[] = [];
    if (q) pAnd.push({ OR: [{ title: ci(q) }, { platform: ci(q) }, { genre: ci(q) }, { filmingLocation: ci(q) }, { productionType: ci(q) }, { castings: { some: { OR: [{ castingOffice: ci(q) }, { castingDirector: { name: ci(q) } }] } } }, ...(qRegion ? [{ region: qRegion }] : [])] });
    if (r) pAnd.push({ OR: [{ region: r }, { breakdowns: { some: { region: r } } }, { submissions: { some: { region: r } } }] });
    if (platform) pAnd.push({ platform: { equals: platform, mode: "insensitive" } });
    if (union) pAnd.push({ unionStatus: ci(union) });
    if (pt) pAnd.push({ productionType: ci(pt) });
    if (cd) pAnd.push({ castings: { some: { OR: [{ castingOffice: ci(cd) }, { castingDirector: { OR: [{ name: ci(cd) }, { castingOffice: ci(cd) }] } }] } } });
    if (source === "public") pAnd.push({ breakdowns: { some: {} } });
    if (source === "agency") pAnd.push({ submissions: { some: {} } });
    if (rel) pAnd.push({ breakdowns: { some: { relevance: rel as "HIGH" } } });
    if (bs) pAnd.push({ blindSpots: { some: { classification: bs as BlindSpotClassification } } });
    if (from) pAnd.push({ discoveredAt: { gte: from } });
    if (toEnd) pAnd.push({ discoveredAt: { lte: toEnd } });

    const sAnd: Prisma.AgencySubmissionWhereInput[] = [];
    if (q) sAnd.push({ OR: [{ projectTitleRaw: ci(q) }, { role: ci(q) }, { castingDirectorRaw: ci(q) }, { platform: ci(q) }, { status: ci(q) }, { notes: ci(q) }, ...(qRegion ? [{ region: qRegion }] : [])] });
    if (r) sAnd.push({ region: r });
    if (platform) sAnd.push({ platform: { equals: platform, mode: "insensitive" } });
    if (union) sAnd.push({ unionStatus: ci(union) });
    if (cd) sAnd.push({ castingDirectorRaw: ci(cd) });
    if (bs) sAnd.push({ blindSpot: { classification: bs as BlindSpotClassification } });
    if (from) sAnd.push({ dateSubmitted: { gte: from } });
    if (toEnd) sAnd.push({ dateSubmitted: { lte: toEnd } });

    const bWhere = breakdownWhere({ ...sp, status: str(sp, "status") ?? "all" });
    const bExtra: Prisma.PublicBreakdownWhereInput = qRegion ? { OR: [bWhere, { region: qRegion }] } : bWhere;

    [projects, cds, breakdowns, submissions] = await Promise.all([
      prisma.project.findMany({ where: { AND: pAnd }, include: { _count: { select: { breakdowns: true, submissions: true } } }, take: 50, orderBy: { updatedAt: "desc" } }),
      q || cd
        ? prisma.castingDirector.findMany({
            where: { OR: [{ name: ci((q ?? cd)!) }, { castingOffice: ci((q ?? cd)!) }, { city: ci((q ?? cd)!) }] },
            take: 30,
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      showPublic && !bs ? prisma.publicBreakdown.findMany({ where: bExtra, include: { project: true }, take: 50, orderBy: { importedAt: "desc" } }) : Promise.resolve([]),
      showAgency && !rel && !pt ? prisma.agencySubmission.findMany({ where: { AND: sAnd }, include: { blindSpot: true }, take: 50, orderBy: { importedAt: "desc" } }) : Promise.resolve([]),
    ]);
  }

  const total = projects.length + cds.length + breakdowns.length + submissions.length;

  return (
    <div className="space-y-5">
      <PageHeader title="Search" description="Search across projects, casting directors, offices, platforms, roles, regions, breakdowns and agency submissions." />
      <FilterBar resetHref="/search" action="/search">
        <div className="col-span-2 sm:col-span-3 lg:col-span-2"><TextFilter name="q" label="Search" value={q} placeholder="Anything…" /></div>
        <Select name="region" label="Region" value={r} options={regionOptions} />
        <Select name="platform" label="Platform" value={platform} options={platforms.map((p) => ({ value: p, label: p }))} />
        <Select name="union" label="Union" value={union} options={["SAG-AFTRA", "AEA", "Non-Union"].map((u) => ({ value: u, label: u }))} />
        <Select name="productionType" label="Production type" value={pt} options={PRODUCTION_TYPES.map((p) => ({ value: p, label: p }))} />
        <TextFilter name="cd" label="Casting director / office" value={cd} />
        <Select name="source" label="Source" value={source} any="Public & agency" options={[{ value: "public", label: "Public only" }, { value: "agency", label: "Agency only" }]} />
        <Select name="relevance" label="Match relevance" value={rel} options={[{ value: "HIGH", label: "High" }, { value: "POSSIBLE", label: "Possible" }, { value: "LOW", label: "Low" }]} />
        <Select name="blindSpot" label="Blind spot status" value={bs} options={CLASSIFICATIONS.map((c) => ({ value: c, label: humanize(c) }))} />
        <TextFilter name="from" label="From" type="date" value={str(sp, "from")} />
        <TextFilter name="to" label="To" type="date" value={str(sp, "to")} />
      </FilterBar>

      {!hasQuery ? (
        <div className="card"><Empty>Enter a search term or choose a filter.</Empty></div>
      ) : total === 0 ? (
        <div className="card"><Empty>No results.</Empty></div>
      ) : (
        <>
          {projects.length > 0 && (
            <Section title={`Projects (${projects.length})`}>
              <ul className="divide-y divide-line">
                {projects.map((p) => (
                  <li key={p.id} className="px-4 py-2.5 text-sm">
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.title}</Link> <DemoBadge show={p.isDemo} />
                    <div className="text-xs text-muted">{[p.platform, p.region && REGION_LABELS[p.region as RegionCode], p.productionType].filter(Boolean).join(" · ")} · {p._count.breakdowns} public · {p._count.submissions} agency</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {cds.length > 0 && (
            <Section title={`Casting directors & offices (${cds.length})`}>
              <ul className="divide-y divide-line">
                {cds.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 text-sm">
                    <Link href={`/casting-directors/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <div className="text-xs text-muted">{[c.castingOffice, c.city && `based in ${c.city}`].filter(Boolean).join(" · ") || "—"}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {breakdowns.length > 0 && (
            <Section title={`Public breakdowns (${breakdowns.length})`}>
              <ul className="divide-y divide-line">
                {breakdowns.map((b) => (
                  <li key={b.id} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Link href={`/opportunities/${b.id}`} className="font-medium hover:underline">{b.project.title} — {b.roleName ?? "role not listed"}</Link>
                      <div className="text-xs text-muted">{b.project.platform ?? "—"} · {b.region ? REGION_LABELS[b.region as RegionCode] : "—"} · {b.source} · posted {fmtDate(b.postedDate)}</div>
                    </div>
                    <div className="flex gap-1.5"><RelevanceBadge tier={b.relevance} /><DeadlineBadge deadline={b.submissionDeadline} /></div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {submissions.length > 0 && (
            <Section title={`Agency submissions (${submissions.length})`}>
              <ul className="divide-y divide-line">
                {submissions.map((s) => (
                  <li key={s.id} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Link href={s.blindSpot ? `/blind-spots/${s.blindSpot.id}` : `/submissions/${s.id}`} className="font-medium hover:underline">{s.projectTitleRaw}{s.role ? ` — ${s.role}` : ""}</Link>
                      <div className="text-xs text-muted">Submitted {fmtDate(s.dateSubmitted)} · {s.castingDirectorRaw ?? "CD not listed"} · {s.platform ?? "—"}</div>
                    </div>
                    {s.blindSpot && <div className="flex gap-1.5"><ClassificationBadge value={s.blindSpot.classification} /><ReviewBadge value={s.blindSpot.reviewStatus} /></div>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
