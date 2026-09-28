import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { deleteProjectAction, mergeProjectsAction, removeCastingCreditAction, updateProjectAction } from "@/app/actions/projects";
import { Badge, ClassificationBadge, DeadlineBadge, DemoBadge, Empty, Flash, KV, PageHeader, RelevanceBadge, Section, SourceLink, SourceStateBadge } from "@/components/ui";
import { WatchButton } from "@/components/WatchButton";
import { ProjectFields } from "@/components/ProjectFields";
import { findProjectCandidates } from "@/lib/server/records";
import { getPlatforms } from "@/lib/server/profile";
import { REGION_LABELS, humanize, type RegionCode } from "@/lib/constants";
import { fmtDate } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await prisma.project.findUnique({ where: { id } });
  return { title: r?.title ?? "Project" };
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string; edit?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const p = await prisma.project.findUnique({
    where: { id },
    include: {
      breakdowns: { orderBy: { importedAt: "desc" } },
      submissions: { include: { blindSpot: true }, orderBy: { dateSubmitted: "desc" } },
      castings: { include: { castingDirector: true } },
      watchItems: true,
      blindSpots: true,
    },
  });
  if (!p) notFound();
  const now = new Date();
  const similar = (await findProjectCandidates({ title: p.title, platform: p.platform, region: p.region, castingDirector: p.castings.map((c) => c.castingDirector.name).join(" & ") || null, includeAgencyOnly: true })).filter((c) => c.projectId !== p.id);
  const watch = p.watchItems.find((w) => w.type === "PROJECT");
  const platforms = sp.edit ? await getPlatforms() : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={p.title}
        description={<span className="flex flex-wrap gap-1.5">{p.agencyReported ? <Badge tone="signal">Agency-reported — not found in public dataset</Badge> : <SourceStateBadge verifiedAt={p.verifiedAt} projectStatus={p.status} />}<Badge tone="muted">{humanize(p.status)}</Badge><DemoBadge show={p.isDemo} /></span>}
        actions={
          <>
            <WatchButton type="PROJECT" value={p.title} projectId={p.id} watchId={watch?.id} back={`/projects/${p.id}`} />
            <Link href={`/opportunities/new?projectId=${p.id}`} className="btn-secondary">Add breakdown</Link>
            <Link href={`/projects/${p.id}?edit=1#edit`} className="btn-secondary">Edit</Link>
          </>
        }
      />
      <Flash message={sp.msg} />
      <Flash message={sp.error} tone="bad" />

      <Section title="Project">
        <dl className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
          <KV label="Platform">{p.platform}</KV>
          <KV label="Production type">{p.productionType}</KV>
          <KV label="Project region">{p.region ? REGION_LABELS[p.region as RegionCode] : "—"}</KV>
          <KV label="Filming location">{p.filmingLocation}</KV>
          <KV label="Union">{p.unionStatus}</KV>
          <KV label="Genre">{p.genre}</KV>
          <KV label="Normalized title"><code className="text-xs">{p.normalizedTitle}</code></KV>
          <KV label="Source"><SourceLink url={p.sourceUrl} name={p.sourceName} /></KV>
          <KV label="Discovered">{fmtDate(p.discoveredAt)}</KV>
          <KV label="Last verified">{p.verifiedAt ? fmtDate(p.verifiedAt) : "Unverified"}</KV>
        </dl>
        {p.notes && <p className="whitespace-pre-line border-t border-line px-4 py-3 text-sm text-ink-soft">{p.notes}</p>}
      </Section>

      <Section title="Casting">
        {p.castings.length === 0 ? <Empty>No casting directors linked.</Empty> : (
          <ul className="divide-y divide-line">
            {p.castings.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div>
                  <Link href={`/casting-directors/${c.castingDirector.id}`} className="font-medium hover:underline">{c.castingDirector.name}</Link>
                  <span className="text-xs text-muted"> · {c.role ?? "Casting"}{c.castingOffice ? ` · ${c.castingOffice}` : ""}{c.castingDirector.city ? ` · based in ${c.castingDirector.city}` : ""}</span>
                </div>
                <form action={removeCastingCreditAction}><input type="hidden" name="id" value={c.id} /><button className="btn-ghost text-xs">Remove</button></form>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Public breakdowns">
        {p.breakdowns.length === 0 ? <Empty>No public breakdowns for this project in your dataset.</Empty> : (
          <ul className="divide-y divide-line">
            {p.breakdowns.map((b) => (
              <li key={b.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link href={`/opportunities/${b.id}`} className="font-medium hover:underline">{b.roleName ?? "Role not listed"}</Link>
                  <div className="text-xs text-muted">{b.source} · posted {fmtDate(b.postedDate)} · {b.region ? REGION_LABELS[b.region as RegionCode] : "region not stated"}</div>
                </div>
                <div className="flex flex-wrap gap-1.5"><RelevanceBadge tier={b.relevance} /><DeadlineBadge deadline={b.submissionDeadline} now={now} /><SourceStateBadge verifiedAt={b.verifiedAt} visibility={b.visibility} submissionDeadline={b.submissionDeadline} projectStatus={p.status} now={now} /></div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Agency submissions">
        {p.submissions.length === 0 ? <Empty>None.</Empty> : (
          <ul className="divide-y divide-line">
            {p.submissions.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">{s.projectTitleRaw} {s.role ? `— ${s.role}` : ""}</div>
                  <div className="text-xs text-muted">Submitted {fmtDate(s.dateSubmitted)} · {s.status ?? "status not listed"} · {s.source}</div>
                </div>
                {s.blindSpot && <Link href={`/blind-spots/${s.blindSpot.id}`}><ClassificationBadge value={s.blindSpot.classification} /></Link>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Possible duplicate projects" subtitle="Similar records in your data. Merging only happens when you confirm it.">
        {similar.length === 0 ? <Empty>No similar projects found.</Empty> : (
          <ul className="divide-y divide-line">
            {similar.map((c) => (
              <li key={c.projectId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/projects/${c.projectId}`} className="font-medium hover:underline">{c.title}</Link>
                  <Badge tone={c.match.verdict === "LIKELY_MATCH" ? "good" : "warn"}>{c.match.verdict === "LIKELY_MATCH" ? "Likely same" : "Uncertain"}</Badge>
                  <span className="text-xs text-muted">similarity {Math.round(c.match.score * 100)}% · {c.match.factors.filter((f) => f.score !== null).map((f) => f.note).join(" · ")}</span>
                </div>
                <form action={mergeProjectsAction} className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <input type="hidden" name="targetId" value={p.id} /><input type="hidden" name="sourceId" value={c.projectId} />
                  <label className="flex items-center gap-2"><input type="checkbox" name="confirm" value="yes" /> These are the same project</label>
                  <button className="btn-secondary">Merge “{c.title}” into this project</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {sp.edit && (
        <div id="edit">
          <h2 className="mb-3 text-lg font-semibold">Edit project</h2>
          <form action={updateProjectAction} className="space-y-4">
            <input type="hidden" name="id" value={p.id} />
            <ProjectFields platforms={platforms} cdHint="Adds casting directors to this project (existing credits stay)." d={{ title: p.title, platform: p.platform, productionType: p.productionType, region: p.region, filmingLocation: p.filmingLocation, unionStatus: p.unionStatus, genre: p.genre, status: p.status, sourceName: p.sourceName, sourceUrl: p.sourceUrl, notes: p.notes }} />
            <button className="btn-primary">Save changes</button>
          </form>
          <form action={deleteProjectAction} className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <input type="hidden" name="id" value={p.id} />
            <label className="flex items-center gap-2"><input type="checkbox" name="confirm" value="yes" /> Permanently delete this project, its breakdowns and blind-spot records</label>
            <button className="btn-danger">Delete project</button>
          </form>
        </div>
      )}
    </div>
  );
}
