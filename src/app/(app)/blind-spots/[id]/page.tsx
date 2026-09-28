import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { resolveBlindSpotAction, saveBlindSpotNotesAction } from "@/app/actions/blindspots";
import { Badge, ClassificationBadge, DemoBadge, Flash, KV, PageHeader, ReviewBadge, Section } from "@/components/ui";
import { BLIND_SPOT_EXPLANATION, REGION_LABELS, type RegionCode } from "@/lib/constants";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { MatchFactor } from "@/lib/matching/fuzzy";

interface StoredCandidate {
  projectId: string;
  title: string;
  score: number;
  verdict: string;
  conflicts: string[];
  factors: MatchFactor[];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await prisma.blindSpot.findUnique({ where: { id }, include: { project: true } });
  return { title: r ? `Review: ${r.project.title}` : "Blind spot" };
}

export default async function BlindSpotPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await prisma.blindSpot.findUnique({ where: { id }, include: { project: true, candidateProject: true, agencySubmission: true } });
  if (!s) notFound();
  const details = (s.matchDetails ?? {}) as { explanation?: string; candidates?: StoredCandidate[]; duplicateOf?: string | null };
  const candidates = details.candidates ?? [];
  const candidateProjects = await prisma.project.findMany({
    where: { id: { in: candidates.map((c) => c.projectId) } },
    include: { breakdowns: { orderBy: { importedAt: "desc" } }, castings: { include: { castingDirector: true } } },
  });
  const sub = s.agencySubmission;
  const title = sub?.projectTitleRaw ?? s.project.title;

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={<span className="flex flex-wrap gap-1.5"><ClassificationBadge value={s.classification} /><ReviewBadge value={s.reviewStatus} /><DemoBadge show={s.project.isDemo} /></span>}
        actions={<Link href="/blind-spots" className="btn-ghost">← All blind spots</Link>}
      />
      <Flash message={sp.msg} />
      <Flash message={sp.error} tone="bad" />

      <div className="rounded-lg border border-signal/30 bg-signal-soft px-4 py-3 text-sm text-ink">
        {s.classification === "AGENCY_REPORTED_NOT_FOUND" && <><strong>Why flagged:</strong> {BLIND_SPOT_EXPLANATION}</>}
        {s.classification === "NEEDS_REVIEW" && <><strong>Why flagged:</strong> {details.explanation}</>}
        {s.classification === "PUBLIC_MATCH" && <><strong>Public match:</strong> {details.explanation ?? `Linked to ${s.project.title}.`}</>}
        {s.classification === "POSSIBLE_DUPLICATE" && <><strong>Possible duplicate:</strong> {details.explanation}</>}
        <p className="mt-1 text-xs text-muted">
          This compares your agency’s report with the public data you’ve collected. It does not show that a breakdown was agent-only; a project can be missing because it hasn’t been imported yet, was listed under another title, or closed.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Agency-reported submission">
          <dl className="grid grid-cols-2 gap-4 p-4">
            <KV label="Project (as reported)">{sub?.projectTitleRaw ?? "—"}</KV>
            <KV label="Date submitted">{fmtDate(sub?.dateSubmitted)}</KV>
            <KV label="Role">{sub?.role}</KV>
            <KV label="Casting director">{sub?.castingDirectorRaw}</KV>
            <KV label="Platform">{sub?.platform}</KV>
            <KV label="Region">{sub?.region ? REGION_LABELS[sub.region as RegionCode] : "—"}</KV>
            <KV label="Union">{sub?.unionStatus}</KV>
            <KV label="Status">{sub?.status}</KV>
            <KV label="Source">{sub?.source}</KV>
            <KV label="Detected">{fmtDateTime(s.detectionDate)}</KV>
          </dl>
          {sub?.notes && <p className="border-t border-line px-4 py-3 text-sm text-ink-soft">{sub.notes}</p>}
        </Section>

        <Section title="Linked project">
          <dl className="grid grid-cols-2 gap-4 p-4">
            <KV label="Project"><Link href={`/projects/${s.project.id}`} className="link">{s.project.title}</Link></KV>
            <KV label="Origin">{s.project.agencyReported ? <Badge tone="signal">Agency-reported only</Badge> : <Badge tone="good">In public dataset</Badge>}</KV>
            <KV label="Match confidence">{Math.round(s.confidence * 100)}% <span className="text-xs text-muted">(record similarity, not a talent score)</span></KV>
            <KV label="Reviewed">{s.reviewedAt ? fmtDateTime(s.reviewedAt) : "Not yet"}</KV>
          </dl>
        </Section>
      </div>

      <Section title="Public dataset candidates" subtitle="Side-by-side comparison. Uncertain matches are never merged without your confirmation.">
        {candidates.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No similar projects found in the current public dataset.</p>
        ) : (
          <form action={resolveBlindSpotAction}>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="decision" value="SAME_AS_CANDIDATE" />
            <div className="divide-y divide-line">
              {candidates.map((c, i) => {
                const p = candidateProjects.find((x) => x.id === c.projectId);
                return (
                  <div key={c.projectId} className="p-4">
                    <label className="flex cursor-pointer flex-wrap items-center gap-3">
                      <input type="radio" name="candidateProjectId" value={c.projectId} defaultChecked={i === 0} />
                      <span className="font-medium">{c.title}</span>
                      <Badge tone={c.verdict === "LIKELY_MATCH" ? "good" : "warn"}>{c.verdict === "LIKELY_MATCH" ? "Likely match" : "Uncertain"}</Badge>
                      <span className="text-xs text-muted">similarity {Math.round(c.score * 100)}%</span>
                      {c.conflicts.map((x) => <Badge key={x} tone="bad">{x}</Badge>)}
                      <Link href={`/projects/${c.projectId}`} className="link text-xs">open project</Link>
                    </label>
                    <div className="mt-3 overflow-x-auto">
                      <table className="table-base min-w-[560px]">
                        <thead><tr><th>Factor</th><th>Agency report</th><th>Public record</th><th>Comparison</th></tr></thead>
                        <tbody>
                          {c.factors.map((f) => (
                            <tr key={f.factor}>
                              <td className="font-medium">{f.factor}</td>
                              <td>{agencyValue(f.factor, sub)}</td>
                              <td>{publicValue(f.factor, p)}</td>
                              <td className={f.score === null ? "text-muted" : f.score >= 0.75 ? "text-emerald-700" : f.score >= 0.5 ? "text-amber-700" : "text-red-700"}>{f.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
            {s.classification !== "PUBLIC_MATCH" || s.reviewStatus === "UNREVIEWED" ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-line bg-paper/60 p-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="confirm" value="yes" /> I’ve checked: the agency submission and the selected public project are the same project</label>
                <button className="btn-primary">Link as same project</button>
              </div>
            ) : null}
          </form>
        )}
      </Section>

      <Section title="Review decision">
        <div className="flex flex-wrap gap-2 p-4">
          <form action={resolveBlindSpotAction}>
            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="decision" value="NOT_FOUND" />
            <button className="btn-secondary" title="Mark that you checked and could not find this project publicly">Confirm not found in public dataset</button>
          </form>
          <form action={resolveBlindSpotAction}>
            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="decision" value="DISMISS" />
            <button className="btn-secondary">Dismiss</button>
          </form>
          <form action={resolveBlindSpotAction}>
            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="decision" value="REOPEN" />
            <button className="btn-ghost">Reopen &amp; re-run detection</button>
          </form>
        </div>
        <form action={saveBlindSpotNotesAction} className="border-t border-line p-4">
          <input type="hidden" name="id" value={s.id} />
          <label className="label" htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" defaultValue={s.notes ?? ""} rows={3} className="input" placeholder="e.g. Checked public listings on (date); agent confirmed title." />
          <button className="btn-secondary mt-2">Save notes</button>
        </form>
      </Section>
    </div>
  );
}

type Sub = { projectTitleRaw: string; castingDirectorRaw: string | null; platform: string | null; role: string | null; dateSubmitted: Date | null; region: string | null } | null;
type Pub = { title: string; platform: string | null; region: string | null; castings: { castingDirector: { name: string } }[]; breakdowns: { roleName: string | null; postedDate: Date | null; importedAt: Date; castingDirectorRaw: string | null; region: string | null }[] } | undefined;

function agencyValue(factor: string, s: Sub) {
  if (!s) return "—";
  switch (factor) {
    case "Title": return s.projectTitleRaw;
    case "Casting director": return s.castingDirectorRaw ?? "—";
    case "Platform": return s.platform ?? "—";
    case "Role": return s.role ?? "—";
    case "Date proximity": return fmtDate(s.dateSubmitted);
    case "Region": return s.region ? REGION_LABELS[s.region as RegionCode] : "—";
  }
  return "—";
}

function publicValue(factor: string, p: Pub) {
  if (!p) return "—";
  switch (factor) {
    case "Title": return p.title;
    case "Casting director": return p.castings.map((c) => c.castingDirector.name).join(", ") || p.breakdowns[0]?.castingDirectorRaw || "—";
    case "Platform": return p.platform ?? "—";
    case "Role": return p.breakdowns.map((b) => b.roleName).filter(Boolean).join(", ") || "—";
    case "Date proximity": return p.breakdowns.map((b) => fmtDate(b.postedDate ?? b.importedAt)).join(", ") || "—";
    case "Region": {
      const r = p.region ?? p.breakdowns.find((b) => b.region)?.region;
      return r ? REGION_LABELS[r as RegionCode] : "—";
    }
  }
  return "—";
}
