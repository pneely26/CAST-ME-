import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { Badge, DemoBadge, Empty, PageHeader, SourceStateBadge } from "@/components/ui";
import { FilterBar, Select, TextFilter, regionOptions } from "@/components/Filters";
import { region, str, type SP } from "@/lib/server/filters";
import { getPlatforms } from "@/lib/server/profile";
import { REGION_LABELS, type RegionCode } from "@/lib/constants";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = str(sp, "q");
  const r = region(sp);
  const platform = str(sp, "platform");
  const origin = str(sp, "origin");
  const and: Prisma.ProjectWhereInput[] = [];
  if (q) and.push({ OR: [{ title: { contains: q, mode: "insensitive" } }, { normalizedTitle: { contains: q.toLowerCase() } }, { castings: { some: { castingDirector: { name: { contains: q, mode: "insensitive" } } } } }] });
  if (r) and.push({ OR: [{ region: r }, { breakdowns: { some: { region: r } } }] });
  if (platform) and.push({ platform: { equals: platform, mode: "insensitive" } });
  if (origin === "public") and.push({ breakdowns: { some: {} } });
  if (origin === "agency") and.push({ submissions: { some: {} } });
  if (origin === "agencyOnly") and.push({ agencyReported: true });
  const [projects, platforms] = await Promise.all([
    prisma.project.findMany({
      where: { AND: and },
      include: { _count: { select: { breakdowns: true, submissions: true } }, castings: { include: { castingDirector: true } } },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    getPlatforms(),
  ]);
  return (
    <div>
      <PageHeader title="Projects" description="Every project on file — public, agency-reported, or both." actions={<Link href="/projects/new" className="btn-primary">New project</Link>} />
      <FilterBar resetHref="/projects">
        <TextFilter name="q" label="Search" value={q} placeholder="Title or casting director" />
        <Select name="region" label="Region" value={r} options={regionOptions} />
        <Select name="platform" label="Platform" value={platform} options={platforms.map((p) => ({ value: p, label: p }))} />
        <Select name="origin" label="Source" value={origin} any="All" options={[{ value: "public", label: "Has public breakdowns" }, { value: "agency", label: "Has agency submissions" }, { value: "agencyOnly", label: "Agency-reported only" }]} />
      </FilterBar>
      <div className="card overflow-x-auto">
        {projects.length === 0 ? <Empty>No projects found.</Empty> : (
          <table className="table-base">
            <thead><tr><th>Project</th><th className="hidden md:table-cell">Platform</th><th className="hidden md:table-cell">Region</th><th className="hidden lg:table-cell">Casting</th><th>Data</th><th className="hidden sm:table-cell">Source status</th><th className="hidden lg:table-cell">Discovered</th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-paper/60">
                  <td><Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.title}</Link> <DemoBadge show={p.isDemo} /><div className="text-xs text-muted md:hidden">{[p.platform, p.region && REGION_LABELS[p.region as RegionCode]].filter(Boolean).join(" · ")}</div></td>
                  <td className="hidden md:table-cell">{p.platform ?? "—"}</td>
                  <td className="hidden md:table-cell">{p.region ? REGION_LABELS[p.region as RegionCode] : "—"}</td>
                  <td className="hidden lg:table-cell">{p.castings.map((c) => c.castingDirector.name).join(", ") || "—"}</td>
                  <td className="whitespace-nowrap">
                    {p._count.breakdowns > 0 && <Badge tone="good">{p._count.breakdowns} public</Badge>}{" "}
                    {p._count.submissions > 0 && <Badge tone={p.agencyReported ? "signal" : "accent"}>{p._count.submissions} agency</Badge>}
                  </td>
                  <td className="hidden sm:table-cell">{p.agencyReported ? <Badge tone="signal">Agency report</Badge> : <SourceStateBadge verifiedAt={p.verifiedAt} projectStatus={p.status} />}</td>
                  <td className="hidden whitespace-nowrap lg:table-cell">{fmtDate(p.discoveredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
