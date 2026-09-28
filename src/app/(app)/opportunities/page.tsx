import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { OpportunityCard } from "@/components/OpportunityCard";
import { Empty, PageHeader } from "@/components/ui";
import { FilterBar, Select, TextFilter, regionOptions } from "@/components/Filters";
import { breakdownInclude } from "@/lib/server/queries";
import { breakdownWhere, str, type SP } from "@/lib/server/filters";
import { getPlatforms } from "@/lib/server/profile";
import { PRODUCTION_TYPES } from "@/lib/constants";

export const metadata = { title: "Opportunities" };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const now = new Date();
  const sort = str(sp, "sort") ?? "recent";
  const [items, platforms] = await Promise.all([
    prisma.publicBreakdown.findMany({
      where: breakdownWhere(sp, now),
      include: breakdownInclude,
      orderBy: sort === "deadline" ? [{ submissionDeadline: { sort: "asc", nulls: "last" } }] : [{ importedAt: "desc" }],
      take: 200,
    }),
    getPlatforms(),
  ]);
  return (
    <div>
      <PageHeader
        title="Opportunities"
        description="Public casting listings you imported or entered. Relevance is based only on details explicitly stated in each breakdown."
        actions={<Link href="/opportunities/new" className="btn-primary">New breakdown</Link>}
      />
      <FilterBar resetHref="/opportunities">
        <TextFilter name="q" label="Search" value={str(sp, "q")} placeholder="Title, role, description…" />
        <Select name="region" label="Region" value={str(sp, "region")} options={regionOptions} />
        <Select name="platform" label="Platform" value={str(sp, "platform")} options={platforms.map((p) => ({ value: p, label: p }))} />
        <Select name="union" label="Union" value={str(sp, "union")} options={["SAG-AFTRA", "AEA", "Non-Union"].map((u) => ({ value: u, label: u }))} />
        <Select name="productionType" label="Production type" value={str(sp, "productionType")} options={PRODUCTION_TYPES.map((p) => ({ value: p, label: p }))} />
        <TextFilter name="cd" label="Casting director / office" value={str(sp, "cd")} />
        <Select name="relevance" label="Match relevance" value={str(sp, "relevance")} options={[{ value: "HIGH", label: "High" }, { value: "POSSIBLE", label: "Possible" }, { value: "LOW", label: "Low" }]} />
        <Select name="status" label="Casting status" value={str(sp, "status") ?? "open"} any="All" options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed / passed" }]} />
        <TextFilter name="from" label="Posted from" type="date" value={str(sp, "from")} />
        <TextFilter name="to" label="Posted to" type="date" value={str(sp, "to")} />
        <Select name="sort" label="Sort" value={sort} any="Most recent" options={[{ value: "deadline", label: "Nearest deadline" }]} />
      </FilterBar>
      <p className="mb-3 text-sm text-muted">{items.length} listing{items.length === 1 ? "" : "s"}</p>
      {items.length === 0 ? (
        <div className="card"><Empty>No opportunities match these filters.</Empty></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((b) => <OpportunityCard key={b.id} b={b} now={now} />)}
        </div>
      )}
    </div>
  );
}
