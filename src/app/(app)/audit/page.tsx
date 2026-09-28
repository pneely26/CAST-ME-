import type { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { FilterBar, Select } from "@/components/Filters";
import { humanize } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import { str, type SP } from "@/lib/server/filters";

export const metadata = { title: "Audit log" };
const ACTIONS: AuditAction[] = ["IMPORT", "CREATE", "EDIT", "DELETE", "BLIND_SPOT_CREATED", "BLIND_SPOT_RESOLVED", "WATCHLIST_ADDED", "WATCHLIST_REMOVED"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const action = str(sp, "action") as AuditAction | undefined;
  const logs = await prisma.auditLog.findMany({ where: action && ACTIONS.includes(action) ? { action } : {}, orderBy: { createdAt: "desc" }, take: 500 });
  return (
    <div>
      <PageHeader title="Audit log" description="Imports, edits, deletions, blind-spot changes and watchlist changes, with timestamps (UTC)." />
      <FilterBar resetHref="/audit">
        <Select name="action" label="Action" value={action} any="All" options={ACTIONS.map((a) => ({ value: a, label: humanize(a) }))} />
      </FilterBar>
      <Section title={`${logs.length} entr${logs.length === 1 ? "y" : "ies"}`}>
        {logs.length === 0 ? <Empty>No entries.</Empty> : (
          <ul className="divide-y divide-line">
            {logs.map((l) => (
              <li key={l.id} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-4">
                <span className="w-44 flex-none text-xs tabular-nums text-muted">{fmtDateTime(l.createdAt)}</span>
                <span className="w-44 flex-none"><Badge tone={l.action.startsWith("BLIND") ? "signal" : l.action === "DELETE" ? "bad" : l.action === "IMPORT" ? "accent" : "neutral"}>{humanize(l.action)}</Badge></span>
                <span className="min-w-0 flex-1">{l.summary} <span className="text-xs text-muted">· {l.entityType}</span></span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
