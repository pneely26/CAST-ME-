import Link from "next/link";
import clsx from "clsx";
import type { DateRange } from "@/lib/time";

/** Today / This week / This month / Custom date filter, as plain links + a GET form. */
export function RangePicker({ range, basePath, extra = {}, allowAll }: { range: DateRange; basePath: string; extra?: Record<string, string>; allowAll?: boolean }) {
  const href = (r: string) => `${basePath}?${new URLSearchParams({ ...extra, range: r })}`;
  const presets: [string, string][] = [["today", "Today"], ["week", "This week"], ["month", "This month"], ...(allowAll ? ([["all", "All time"]] as [string, string][]) : [])];
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex rounded-md border border-line bg-white p-0.5 text-sm" role="group" aria-label="Date range">
        {presets.map(([k, l]) => (
          <Link key={k} href={href(k)} aria-current={range.preset === k ? "true" : undefined} className={clsx("rounded px-2.5 py-1", range.preset === k ? "bg-accent text-white" : "text-ink-2 hover:bg-canvas")}>
            {l}
          </Link>
        ))}
      </div>
      <form method="get" action={basePath} className="flex items-end gap-1">
        {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="hidden" name="range" value="custom" />
        <input type="date" name="from" defaultValue={range.preset === "custom" ? range.startKey : ""} className="input w-[140px] py-1" aria-label="From date" required />
        <input type="date" name="to" defaultValue={range.preset === "custom" ? range.endKey : ""} className="input w-[140px] py-1" aria-label="To date" required />
        <button className={clsx("btn-secondary py-1", range.preset === "custom" && "border-accent text-accent")}>Custom</button>
      </form>
    </div>
  );
}
