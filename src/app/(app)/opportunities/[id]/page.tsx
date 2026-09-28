import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { closeBreakdownAction, deleteBreakdownAction, updateBreakdownAction, verifyBreakdownAction } from "@/app/actions/opportunities";
import { Badge, DeadlineBadge, DemoBadge, Flash, KV, PageHeader, Section, SourceLink, SourceStateBadge } from "@/components/ui";
import { WhyMatched } from "@/components/WhyMatched";
import { WatchButton } from "@/components/WatchButton";
import { BreakdownRoleFields } from "@/components/BreakdownRoleFields";
import { REGION_LABELS, type RegionCode } from "@/lib/constants";
import { fmtDate, fmtDateTime, isoDay } from "@/lib/format";
import type { RelevanceResult } from "@/lib/matching/profile";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await prisma.publicBreakdown.findUnique({ where: { id }, include: { project: true } });
  return { title: r ? `${r.project.title}${r.roleName ? ` — ${r.roleName}` : ""}` : "Opportunity" };
}

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string; edit?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const b = await prisma.publicBreakdown.findUnique({
    where: { id },
    include: { project: { include: { castings: { include: { castingDirector: { include: { watchItems: true } } } }, watchItems: true, submissions: true } } },
  });
  if (!b) notFound();
  const now = new Date();
  const p = b.project;
  const region = b.region ?? p.region;
  const projectWatch = p.watchItems.find((w) => w.type === "PROJECT");

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${p.title}${b.roleName ? ` — ${b.roleName}` : ""}`}
        description={<span className="flex flex-wrap gap-1.5"><DeadlineBadge deadline={b.submissionDeadline} now={now} /><SourceStateBadge verifiedAt={b.verifiedAt} visibility={b.visibility} submissionDeadline={b.submissionDeadline} projectStatus={p.status} now={now} /><Badge tone="muted">{b.visibility}</Badge><DemoBadge show={b.isDemo} /></span>}
        actions={
          <>
            <WatchButton type="PROJECT" value={p.title} projectId={p.id} watchId={projectWatch?.id} back={`/opportunities/${b.id}`} />
            <Link href={`/opportunities/${b.id}?edit=1#edit`} className="btn-secondary">Edit</Link>
          </>
        }
      />
      <Flash message={sp.msg} />
      <Flash message={sp.error} tone="bad" />

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Why this matched" className="lg:col-span-2">
          <div className="p-4"><WhyMatched result={b.relevanceDetails as unknown as RelevanceResult | null} /></div>
        </Section>
        <Section title="Source">
          <dl className="grid gap-3 p-4">
            <KV label="Source"><SourceLink url={b.sourceUrl} name={b.source} /></KV>
            <KV label="Date discovered">{fmtDateTime(b.importedAt)}</KV>
            <KV label="Last verified">{b.verifiedAt ? fmtDate(b.verifiedAt) : <Badge tone="muted">Unverified</Badge>}</KV>
            <KV label="Posted">{fmtDate(b.postedDate)}</KV>
            <KV label="Deadline">{fmtDate(b.submissionDeadline)}</KV>
          </dl>
          <div className="flex flex-wrap gap-2 border-t border-line p-4">
            <form action={verifyBreakdownAction}><input type="hidden" name="id" value={b.id} /><button className="btn-secondary">Mark verified today</button></form>
            {b.visibility !== "CLOSED" && <form action={closeBreakdownAction}><input type="hidden" name="id" value={b.id} /><button className="btn-secondary">Mark casting closed</button></form>}
          </div>
        </Section>
      </div>

      <Section title="Details">
        <dl className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
          <KV label="Project"><Link href={`/projects/${p.id}`} className="link">{p.title}</Link></KV>
          <KV label="Platform">{p.platform}</KV>
          <KV label="Production type">{p.productionType}</KV>
          <KV label="Breakdown region">{region ? REGION_LABELS[region as RegionCode] : "—"}</KV>
          <KV label="Role">{b.roleName}</KV>
          <KV label="Role type">{b.roleType}</KV>
          <KV label="Age range (stated)">{b.ageRange}</KV>
          <KV label="Gender (stated)">{b.gender}</KV>
          <KV label="Ethnicity (stated)">{b.ethnicity ?? "Not stated"}</KV>
          <KV label="Union">{b.unionStatus ?? p.unionStatus}</KV>
          <KV label="Casting (as listed)">{b.castingDirectorRaw}</KV>
          <KV label="Casting office">{b.castingOfficeRaw}</KV>
        </dl>
        {b.characterDescription && <p className="border-t border-line px-4 py-3 text-sm leading-relaxed">{b.characterDescription}</p>}
        {p.castings.length > 0 && (
          <div className="border-t border-line px-4 py-3">
            <div className="label">Casting directors on file</div>
            <ul className="mt-1 flex flex-wrap gap-3">
              {p.castings.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <Link href={`/casting-directors/${c.castingDirector.id}`} className="link">{c.castingDirector.name}</Link>
                  {c.castingDirector.city && <span className="text-xs text-muted">(based in {c.castingDirector.city})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {p.submissions.length > 0 && (
          <div className="border-t border-line px-4 py-3 text-sm">
            <Badge tone="accent">Agency submission on file</Badge> <span className="text-ink-soft">Your agency reported {p.submissions.length} submission(s) for this project.</span>
          </div>
        )}
      </Section>

      {sp.edit && (
        <div id="edit">
          <h2 className="mb-3 text-lg font-semibold">Edit breakdown</h2>
          <form action={updateBreakdownAction} className="space-y-4">
            <input type="hidden" name="id" value={b.id} />
            <BreakdownRoleFields
              d={{
                roleName: b.roleName, roleType: b.roleType, ageRange: b.ageRange, gender: b.gender, ethnicity: b.ethnicity, unionStatus: b.unionStatus,
                characterDescription: b.characterDescription, castingDirector: b.castingDirectorRaw, castingOffice: b.castingOfficeRaw, region: b.region,
                visibility: b.visibility, postedDate: isoDay(b.postedDate), submissionDeadline: isoDay(b.submissionDeadline), source: b.source, sourceUrl: b.sourceUrl,
              }}
            />
            <div className="flex gap-2"><button className="btn-primary">Save changes</button><Link href={`/opportunities/${b.id}`} className="btn-ghost">Cancel</Link></div>
          </form>
        </div>
      )}

      <Section title="Danger zone">
        <form action={deleteBreakdownAction} className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <input type="hidden" name="id" value={b.id} />
          <label className="flex items-center gap-2"><input type="checkbox" name="confirm" value="yes" /> I understand this permanently deletes this breakdown</label>
          <button className="btn-danger">Delete breakdown</button>
        </form>
      </Section>
    </div>
  );
}
