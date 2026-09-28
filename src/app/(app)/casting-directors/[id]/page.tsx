import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { deleteCastingDirectorAction, updateCastingDirectorAction } from "@/app/actions/castingDirectors";
import { Badge, DeadlineBadge, DemoBadge, Empty, Flash, KV, PageHeader, Section, SourceLink, SourceStateBadge, Stat } from "@/components/ui";
import { WatchButton } from "@/components/WatchButton";
import { CastingDirectorFields } from "@/components/CastingDirectorFields";
import { REGION_LABELS, type RegionCode } from "@/lib/constants";
import { fmtDate, relativeDays } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await prisma.castingDirector.findUnique({ where: { id } });
  return { title: r?.name ?? "Casting director" };
}

export default async function CDPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string; edit?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const cd = await prisma.castingDirector.findUnique({
    where: { id },
    include: {
      watchItems: true,
      castings: {
        include: {
          project: {
            include: {
              breakdowns: { orderBy: { importedAt: "desc" } },
              submissions: { orderBy: { dateSubmitted: "desc" } },
            },
          },
        },
      },
    },
  });
  if (!cd) notFound();
  const now = new Date();
  const projects = cd.castings.map((c) => ({ ...c.project, creditRole: c.role }));
  const isOpen = (p: (typeof projects)[number]) =>
    p.breakdowns.some((b) => b.visibility !== "CLOSED" && (!b.submissionDeadline || b.submissionDeadline >= now));
  const lastDate = (p: (typeof projects)[number]) =>
    Math.max(p.discoveredAt.getTime(), ...p.breakdowns.map((b) => (b.postedDate ?? b.importedAt).getTime()), ...p.submissions.map((s) => (s.dateSubmitted ?? s.importedAt).getTime()));
  const current = projects.filter(isOpen);
  const recent = projects.filter((p) => !isOpen(p)).sort((a, b) => lastDate(b) - lastDate(a));
  const publicCount = projects.reduce((n, p) => n + p.breakdowns.length, 0);
  const agencyCount = projects.filter((p) => p.submissions.length > 0).length;
  const last = projects.length ? new Date(Math.max(...projects.map(lastDate))) : null;
  const w = cd.watchItems.find((x) => x.type === "CASTING_DIRECTOR");
  const officeWatch = cd.castingOffice ? await prisma.watchlistItem.findUnique({ where: { type_value: { type: "CASTING_OFFICE", value: cd.castingOffice } } }) : null;
  const sources = new Map<string, string>();
  if (cd.sourceUrl) sources.set(cd.sourceUrl, cd.sourceName ?? "Profile source");
  if (cd.website) sources.set(cd.website, "Website");
  projects.forEach((p) => p.breakdowns.forEach((b) => b.sourceUrl && sources.set(b.sourceUrl, `${b.source} — ${p.title}`)));

  const ProjectRow = ({ p }: { p: (typeof projects)[number] }) => {
    const b = p.breakdowns[0];
    const region = b?.region ?? p.region;
    return (
      <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.title}</Link>{" "}
          {p.agencyReported && <Badge tone="signal">Agency-reported</Badge>} <DemoBadge show={p.isDemo} />
          <div className="text-xs text-muted">
            {[p.platform, region && REGION_LABELS[region as RegionCode], p.productionType, p.creditRole].filter(Boolean).join(" · ") || "—"}
          </div>
          <div className="text-xs text-ink-soft">{p.breakdowns.length} public breakdown(s) · {p.submissions.length} agency submission(s)</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {b && <DeadlineBadge deadline={b.submissionDeadline} now={now} />}
          {b && <SourceStateBadge verifiedAt={b.verifiedAt} visibility={b.visibility} submissionDeadline={b.submissionDeadline} projectStatus={p.status} now={now} />}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={cd.name}
        description={<span className="flex flex-wrap items-center gap-2">{cd.castingOffice ?? "Office not listed"}{(cd.city || cd.state) && <> · based in {[cd.city, cd.state].filter(Boolean).join(", ")}</>}<DemoBadge show={cd.isDemo} /></span>}
        actions={
          <>
            <WatchButton type="CASTING_DIRECTOR" value={cd.name} castingDirectorId={cd.id} watchId={w?.id} back={`/casting-directors/${cd.id}`} />
            {cd.castingOffice && <WatchButton type="CASTING_OFFICE" value={cd.castingOffice} watchId={officeWatch?.id} back={`/casting-directors/${cd.id}`} />}
            <Link href={`/casting-directors/${cd.id}?edit=1#edit`} className="btn-secondary">Edit</Link>
          </>
        }
      />
      <Flash message={sp.msg} />
      <Flash message={sp.error} tone="bad" />
      <p className="text-xs text-muted">
        Casting director location (where they are based) is independent of project/breakdown regions — a New York–based casting director can cast a Chicago project.
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Current projects" value={current.length} />
        <Stat label="Public breakdowns found" value={publicCount} />
        <Stat label="Agency-reported projects" value={agencyCount} tone="signal" />
        <Stat label="Last activity" value={<span className="text-base">{last ? relativeDays(last, now) : "—"}</span>} />
      </div>

      <Section title="Current projects" subtitle="Projects with open public breakdowns">
        {current.length ? <ul className="divide-y divide-line">{current.map((p) => <ProjectRow key={p.id} p={p} />)}</ul> : <Empty>No open projects on file.</Empty>}
      </Section>
      <Section title="Recent projects" subtitle="Closed, past-deadline, or agency-reported">
        {recent.length ? <ul className="divide-y divide-line">{recent.map((p) => <ProjectRow key={p.id} p={p} />)}</ul> : <Empty>None.</Empty>}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Record & source">
          <dl className="grid grid-cols-2 gap-4 p-4">
            <KV label="Source">{cd.sourceName ?? "—"}</KV>
            <KV label="Date discovered">{fmtDate(cd.discoveredAt)}</KV>
            <KV label="Last verified">{cd.verifiedAt ? fmtDate(cd.verifiedAt) : <Badge tone="muted">Unverified</Badge>}</KV>
            <KV label="Website">{cd.website ? <SourceLink url={cd.website} name="Website" /> : "—"}</KV>
          </dl>
          {cd.notes && <p className="border-t border-line px-4 py-3 text-sm">{cd.notes}</p>}
        </Section>
        <Section title="Source links">
          {sources.size === 0 ? <Empty>No source links.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {[...sources.entries()].map(([url, name]) => <li key={url} className="truncate px-4 py-2"><SourceLink url={url} name={name} /></li>)}
            </ul>
          )}
        </Section>
      </div>

      {sp.edit && (
        <div id="edit">
          <h2 className="mb-3 text-lg font-semibold">Edit casting director</h2>
          <form action={updateCastingDirectorAction} className="space-y-4">
            <input type="hidden" name="id" value={cd.id} />
            <CastingDirectorFields d={{ name: cd.name, castingOffice: cd.castingOffice, city: cd.city, state: cd.state, website: cd.website, sourceName: cd.sourceName, sourceUrl: cd.sourceUrl, notes: cd.notes }} />
            <button className="btn-primary">Save changes</button>
          </form>
          <form action={deleteCastingDirectorAction} className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <input type="hidden" name="id" value={cd.id} />
            <label className="flex items-center gap-2"><input type="checkbox" name="confirm" value="yes" /> Permanently delete this casting director (project credits are removed)</label>
            <button className="btn-danger">Delete</button>
          </form>
        </div>
      )}
    </div>
  );
}
