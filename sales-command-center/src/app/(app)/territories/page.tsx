import Link from "next/link";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { can } from "@/server/policy";
import { getSettings } from "@/server/settings";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { saveAreaAction, saveTerritoryAction, archiveTerritoryAction } from "@/app/actions/territories";

export const metadata = { title: "Areas & Territories" };

export default async function TerritoriesPage() {
  const actor = await requireActor();
  const manage = can(actor, "territory.manage");
  const settings = await getSettings();
  const stale = new Date(Date.now() - settings.staleVisitDays * 86_400_000);
  const scope = actor.role === "REP" ? { assignedRepId: actor.id } : {};
  const territories = await prisma.territory.findMany({ orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }], include: { areas: { orderBy: { name: "asc" } } } });
  const counts = await prisma.lead.groupBy({ by: ["areaId"], where: { archivedAt: null, ...scope }, _count: true });
  const never = await prisma.lead.groupBy({ by: ["areaId"], where: { archivedAt: null, lastVisitAt: null, ...scope }, _count: true });
  const staleCounts = await prisma.lead.groupBy({ by: ["areaId"], where: { archivedAt: null, lastVisitAt: { lt: stale }, ...scope }, _count: true });
  const c = (arr: { areaId: string | null; _count: number }[], id: string | null) => arr.find((x) => x.areaId === id)?._count ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Areas & Territories" subtitle="Organize leads by territory, area and route. Counts link to the matching leads." />
      {territories.length === 0 && <div className="card"><Empty>No territories yet{manage ? " — add one below." : "."}</Empty></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {territories.map((t) => {
          const total = t.areas.reduce((s, a) => s + c(counts, a.id), 0);
          return (
            <Section
              key={t.id}
              className={t.archivedAt ? "opacity-60" : ""}
              title={<span className="flex items-center gap-2"><span aria-hidden className="h-3 w-3 rounded-full" style={{ background: t.color }} />{t.name}{t.archivedAt && <Badge tone="muted">Archived</Badge>}</span>}
              subtitle={`${t.areas.length} area(s) · ${total} lead(s)`}
              action={<Link className="link text-xs" href={`/leads?territory=${t.id}`}>View leads</Link>}
            >
              {t.areas.length === 0 ? <Empty>No areas yet.</Empty> : (
                <table className="tbl">
                  <thead><tr><th>Area</th><th className="text-right">Leads</th><th className="text-right">Never visited</th><th className="text-right">{settings.staleVisitDays}+ days</th>{manage && <th></th>}</tr></thead>
                  <tbody>
                    {t.areas.map((a) => (
                      <tr key={a.id} className={a.archivedAt ? "opacity-60" : ""}>
                        <td><Link className="hover:underline" href={`/leads?area=${a.id}`}>{a.name}</Link>{a.archivedAt && <> <Badge tone="muted">Archived</Badge></>}{a.notes && <div className="text-xs text-muted">{a.notes}</div>}</td>
                        <td className="text-right tabular-nums"><Link className="link" href={`/leads?area=${a.id}`}>{c(counts, a.id)}</Link></td>
                        <td className="text-right tabular-nums"><Link className="link" href={`/leads?area=${a.id}&visited=never`}>{c(never, a.id)}</Link></td>
                        <td className="text-right tabular-nums"><Link className="link" href={`/leads?area=${a.id}&visited=stale`}>{c(staleCounts, a.id)}</Link></td>
                        {manage && (
                          <td className="text-right">
                            <ActionForm action={archiveTerritoryAction} className="inline">
                              <input type="hidden" name="kind" value="area" /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="archive" value={a.archivedAt ? "false" : "true"} />
                              <SubmitButton className="btn-ghost btn-sm" confirm={a.archivedAt ? undefined : `Archive area ${a.name}? Leads keep it; it just won't be offered for new leads.`}>{a.archivedAt ? "Restore" : "Archive"}</SubmitButton>
                            </ActionForm>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {manage && !t.archivedAt && (
                <div className="flex flex-wrap items-end justify-between gap-2 border-t border-line p-3">
                  <ActionForm action={saveAreaAction} className="flex items-end gap-2" resetOnSuccess>
                    <input type="hidden" name="territoryId" value={t.id} />
                    <label className="block"><span className="label">Add area</span><input name="name" className="input" placeholder="Neighborhood or route" required maxLength={100} /></label>
                    <SubmitButton className="btn-secondary">Add</SubmitButton>
                  </ActionForm>
                  <ActionForm action={archiveTerritoryAction}>
                    <input type="hidden" name="kind" value="territory" /><input type="hidden" name="id" value={t.id} /><input type="hidden" name="archive" value="true" />
                    <SubmitButton className="btn-ghost btn-sm" confirm={`Archive territory ${t.name}?`}>Archive territory</SubmitButton>
                  </ActionForm>
                </div>
              )}
              {manage && t.archivedAt && (
                <ActionForm action={archiveTerritoryAction} className="border-t border-line p-3">
                  <input type="hidden" name="kind" value="territory" /><input type="hidden" name="id" value={t.id} /><input type="hidden" name="archive" value="false" />
                  <SubmitButton className="btn-secondary btn-sm">Restore territory</SubmitButton>
                </ActionForm>
              )}
            </Section>
          );
        })}
      </div>
      {(c(counts, null) > 0) && <p className="text-sm text-muted"><Link className="link" href="/leads?area=none">{c(counts, null)} lead(s) have no area</Link></p>}
      {manage && (
        <Section title="Add territory">
          <ActionForm action={saveTerritoryAction} className="flex flex-wrap items-end gap-3 p-4" resetOnSuccess>
            <label className="block"><span className="label">Name</span><input name="name" className="input" required maxLength={100} placeholder="e.g. North Side" /></label>
            <label className="block"><span className="label">Color</span><input type="color" name="color" defaultValue="#4f46e5" className="h-[38px] w-16 rounded-md border border-line" /></label>
            <label className="block flex-1"><span className="label">Notes</span><input name="notes" className="input" maxLength={2000} /></label>
            <SubmitButton>Add territory</SubmitButton>
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
