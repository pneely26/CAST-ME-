import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { ClassificationBadge, DemoBadge, Empty, Flash, PageHeader, ReviewBadge } from "@/components/ui";
import { FilterBar, Select, TextFilter, regionOptions } from "@/components/Filters";
import { day, region, str, type SP } from "@/lib/server/filters";
import { getPlatforms } from "@/lib/server/profile";
import { REGION_LABELS, type RegionCode } from "@/lib/constants";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Agency Submissions" };

export default async function SubmissionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = str(sp, "q");
  const r = region(sp);
  const platform = str(sp, "platform");
  const from = day(sp, "from");
  const to = day(sp, "to");
  const and: Prisma.AgencySubmissionWhereInput[] = [];
  if (q) and.push({ OR: ["projectTitleRaw", "role", "castingDirectorRaw", "status", "notes"].map((k) => ({ [k]: { contains: q, mode: "insensitive" } })) });
  if (r) and.push({ region: r });
  if (platform) and.push({ platform: { equals: platform, mode: "insensitive" } });
  if (from) and.push({ dateSubmitted: { gte: from } });
  if (to) and.push({ dateSubmitted: { lte: new Date(to.getTime() + 86_399_999) } });
  const [subs, platforms] = await Promise.all([
    prisma.agencySubmission.findMany({ where: { AND: and }, include: { blindSpot: true, project: true }, orderBy: [{ dateSubmitted: { sort: "desc", nulls: "last" } }] }),
    getPlatforms(),
  ]);
  return (
    <div>
      <PageHeader
        title="Agency Submissions"
        description="Submissions your agency reported to you. Private — never published. Each is checked against the public dataset."
        actions={<><Link href="/imports?tab=agency" className="btn-secondary">Import CSV/XLSX</Link><Link href="/submissions/new" className="btn-primary">New submission</Link></>}
      />
      <Flash message={str(sp, "msg")} />
      <FilterBar resetHref="/submissions">
        <TextFilter name="q" label="Search" value={q} placeholder="Project, role, CD, notes" />
        <Select name="region" label="Region" value={r} options={regionOptions} />
        <Select name="platform" label="Platform" value={platform} options={platforms.map((p) => ({ value: p, label: p }))} />
        <TextFilter name="from" label="Submitted from" type="date" value={str(sp, "from")} />
        <TextFilter name="to" label="Submitted to" type="date" value={str(sp, "to")} />
      </FilterBar>
      <div className="card overflow-x-auto">
        {subs.length === 0 ? <Empty>No agency submissions yet.</Empty> : (
          <table className="table-base">
            <thead><tr><th>Submitted</th><th>Project</th><th className="hidden md:table-cell">Role</th><th className="hidden lg:table-cell">Casting director</th><th className="hidden md:table-cell">Platform / Region</th><th>Detection</th><th></th></tr></thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} id={s.id} className="hover:bg-paper/60">
                  <td className="whitespace-nowrap">{fmtDate(s.dateSubmitted)}</td>
                  <td><span className="font-medium">{s.projectTitleRaw}</span> <DemoBadge show={s.isDemo} /><div className="text-xs text-muted">{s.status ?? ""}<span className="md:hidden"> · {s.role ?? ""}</span></div></td>
                  <td className="hidden md:table-cell">{s.role ?? "—"}</td>
                  <td className="hidden lg:table-cell">{s.castingDirectorRaw ?? "—"}</td>
                  <td className="hidden md:table-cell">{s.platform ?? "—"}<div className="text-xs text-muted">{s.region ? REGION_LABELS[s.region as RegionCode] : ""}</div></td>
                  <td>{s.blindSpot ? <Link href={`/blind-spots/${s.blindSpot.id}`} className="flex flex-col items-start gap-1"><ClassificationBadge value={s.blindSpot.classification} /><ReviewBadge value={s.blindSpot.reviewStatus} /></Link> : "—"}</td>
                  <td><Link href={`/submissions/${s.id}`} className="link text-xs">Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
