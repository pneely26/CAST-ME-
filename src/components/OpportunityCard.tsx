import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Badge, DeadlineBadge, DemoBadge, RelevanceBadge, SourceStateBadge } from "./ui";
import { REGION_LABELS, type RegionCode } from "@/lib/constants";

export type BreakdownFull = Prisma.PublicBreakdownGetPayload<{
  include: { project: { include: { castings: { include: { castingDirector: true } } } } };
}>;

export function cdNames(b: BreakdownFull): string {
  if (b.castingDirectorRaw) return b.castingDirectorRaw;
  const names = b.project.castings.map((c) => c.castingDirector.name);
  return names.length ? names.join(", ") : "Not listed";
}

export function OpportunityCard({ b, now }: { b: BreakdownFull; now: Date }) {
  const region = b.region ?? b.project.region;
  return (
    <Link href={`/opportunities/${b.id}`} className="card block p-4 transition-colors hover:border-stone-300">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{b.project.title}</div>
          <div className="truncate text-sm text-ink-soft">{b.roleName ?? "Role not listed"}{b.roleType ? ` · ${b.roleType}` : ""}</div>
        </div>
        <RelevanceBadge tier={b.relevance} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3">
        <Item label="Platform">{b.project.platform ?? "—"}</Item>
        <Item label="Casting director">{cdNames(b)}</Item>
        <Item label="Region">{region ? REGION_LABELS[region as RegionCode] : "—"}</Item>
        <Item label="Union">{b.unionStatus ?? b.project.unionStatus ?? "—"}</Item>
        <Item label="Deadline">{b.submissionDeadline ? b.submissionDeadline.toISOString().slice(0, 10) : "—"}</Item>
        <Item label="Source">{b.source}</Item>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <DeadlineBadge deadline={b.submissionDeadline} now={now} />
        <SourceStateBadge verifiedAt={b.verifiedAt} visibility={b.visibility} submissionDeadline={b.submissionDeadline} projectStatus={b.project.status} now={now} />
        {b.visibility === "PUBLIC" && <Badge tone="muted">Public</Badge>}
        <DemoBadge show={b.isDemo} />
      </div>
    </Link>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}
