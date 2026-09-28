import Link from "next/link";
import type { Prisma, BlindSpotClassification, ReviewStatus } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { rerunDetectionAction } from "@/app/actions/blindspots";
import { ClassificationBadge, DemoBadge, Empty, Flash, PageHeader, ReviewBadge } from "@/components/ui";
import { FilterBar, Select, TextFilter, regionOptions } from "@/components/Filters";
import { BLIND_SPOT_EXPLANATION, CLASSIFICATIONS, REVIEW_STATUSES, REGION_LABELS, humanize, type RegionCode } from "@/lib/constants";
import { region, str, type SP } from "@/lib/server/filters";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Blind Spots" };

export default async function BlindSpotsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const cls = str(sp, "classification");
  const rs = str(sp, "review");
  const q = str(sp, "q");
  const r = region(sp);
  const view = sp.classification === undefined && sp.review === undefined ? "open" : "filtered";
  const and: Prisma.BlindSpotWhereInput[] = [];
  if (view === "open") and.push({ classification: { in: ["AGENCY_REPORTED_NOT_FOUND", "NEEDS_REVIEW"] }, reviewStatus: { not: "DISMISSED" } });
  if (cls && (CLASSIFICATIONS as readonly string[]).includes(cls)) and.push({ classification: cls as BlindSpotClassification });
  if (rs && (REVIEW_STATUSES as readonly string[]).includes(rs)) and.push({ reviewStatus: rs as ReviewStatus });
  if (q) and.push({ OR: [{ project: { title: { contains: q, mode: "insensitive" } } }, { agencySubmission: { castingDirectorRaw: { contains: q, mode: "insensitive" } } }, { agencySubmission: { role: { contains: q, mode: "insensitive" } } }] });
  if (r) and.push({ OR: [{ agencySubmission: { region: r } }, { project: { region: r } }] });

  const [spots, counts] = await Promise.all([
    prisma.blindSpot.findMany({
      where: { AND: and },
      include: { project: true, candidateProject: true, agencySubmission: true },
      orderBy: [{ reviewStatus: "asc" }, { detectionDate: "desc" }],
    }),
    prisma.blindSpot.groupBy({ by: ["classification"], _count: true }),
  ]);
  const count = (c: string) => counts.find((x) => x.classification === c)?._count ?? 0;

  return (
    <div>
      <PageHeader
        title="Blind Spots"
        description={<>Every agency submission is compared with the public dataset. <strong>“{BLIND_SPOT_EXPLANATION}”</strong> A flag means only that — it is never treated as proof of an agent-only breakdown.</>}
        actions={<form action={rerunDetectionAction}><button className="btn-secondary">Re-run detection</button></form>}
      />
      <Flash message={str(sp, "msg")} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {CLASSIFICATIONS.map((c) => (
          <Link key={c} href={`/blind-spots?classification=${c}`} className="card px-4 py-3 hover:border-stone-300">
            <ClassificationBadge value={c} />
            <div className="mt-2 text-2xl font-semibold tabular-nums">{count(c)}</div>
          </Link>
        ))}
      </div>
      <FilterBar resetHref="/blind-spots">
        <TextFilter name="q" label="Search" value={q} placeholder="Project, CD, role" />
        <Select name="classification" label="Classification" value={cls} any="All" options={CLASSIFICATIONS.map((c) => ({ value: c, label: humanize(c) }))} />
        <Select name="review" label="Review status" value={rs} any="All" options={REVIEW_STATUSES.map((c) => ({ value: c, label: humanize(c) }))} />
        <Select name="region" label="Region" value={r} options={regionOptions} />
      </FilterBar>
      <p className="mb-3 text-sm text-muted">{view === "open" ? "Showing open items (potential blind spots and items needing review). Use filters to see all." : `${spots.length} result(s)`}</p>
      <div className="card overflow-hidden">
        {spots.length === 0 ? (
          <Empty>Nothing here.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {spots.map((s) => (
              <li key={s.id}>
                <Link href={`/blind-spots/${s.id}`} className="block px-4 py-3 hover:bg-paper/60">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{s.agencySubmission?.projectTitleRaw ?? s.project.title} <DemoBadge show={s.project.isDemo} /></div>
                    <div className="flex gap-1.5"><ClassificationBadge value={s.classification} /><ReviewBadge value={s.reviewStatus} /></div>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    Submitted {fmtDate(s.agencySubmission?.dateSubmitted)} · {s.agencySubmission?.role ?? "Role not listed"} · {s.agencySubmission?.castingDirectorRaw ?? "CD not listed"} · {s.agencySubmission?.platform ?? "—"} · {s.agencySubmission?.region ? REGION_LABELS[s.agencySubmission.region as RegionCode] : "—"}
                  </div>
                  <div className="mt-1 text-sm text-ink-soft">
                    {s.classification === "AGENCY_REPORTED_NOT_FOUND" && BLIND_SPOT_EXPLANATION}
                    {s.classification === "NEEDS_REVIEW" && <>Possible public match: <strong>{s.candidateProject?.title ?? "—"}</strong> (match confidence {Math.round(s.confidence * 100)}%). Needs your review.</>}
                    {s.classification === "PUBLIC_MATCH" && <>Found in public dataset as <strong>{s.project.title}</strong>.</>}
                    {s.classification === "POSSIBLE_DUPLICATE" && <>Looks like a duplicate of another agency submission.</>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
