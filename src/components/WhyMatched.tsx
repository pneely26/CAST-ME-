import type { RelevanceResult } from "@/lib/matching/profile";
import { RelevanceBadge } from "./ui";

const ICON: Record<string, string> = { MATCH: "✓", OPEN: "○", MISMATCH: "✕", NOT_STATED: "–", INFO: "i" };
const COLOR: Record<string, string> = {
  MATCH: "text-emerald-700 bg-emerald-50",
  OPEN: "text-accent bg-accent-soft",
  MISMATCH: "text-red-700 bg-red-50",
  NOT_STATED: "text-muted bg-stone-100",
  INFO: "text-ink-soft bg-stone-100",
};
const LABEL: Record<string, string> = { MATCH: "Aligns", OPEN: "Open", MISMATCH: "Differs", NOT_STATED: "Not stated", INFO: "Info" };

export function WhyMatched({ result }: { result: RelevanceResult | null }) {
  if (!result) return <p className="text-sm text-muted">Relevance has not been computed yet.</p>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <RelevanceBadge tier={result.tier} />
        <span className="text-sm text-ink-soft">{result.summary}</span>
      </div>
      <ul className="divide-y divide-line rounded-md border border-line">
        {result.factors.map((f) => (
          <li key={f.factor} className="flex items-start gap-3 px-3 py-2 text-sm">
            <span className={`mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded text-xs font-bold ${COLOR[f.outcome]}`} aria-label={LABEL[f.outcome]} title={LABEL[f.outcome]}>
              {ICON[f.outcome]}
            </span>
            <span className="min-w-0 flex-1">{f.detail}</span>
            <span className="hidden text-[11px] uppercase tracking-wide text-muted sm:inline">{LABEL[f.outcome]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Compared only against details explicitly stated in the breakdown. No demographic assumptions are made, and no numeric talent score is produced.
      </p>
    </div>
  );
}
