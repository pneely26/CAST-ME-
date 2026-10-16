import type { OpportunityStatus } from "@prisma/client";
import { OPEN_OPPORTUNITY_STATUSES } from "../labels";

export interface OppLike {
  id: string;
  status: OpportunityStatus;
  estimatedValue: number | null;
  finalAmount: number | null;
  closedAt: Date | null;
  openedAt: Date;
  leadId: string;
  repId: string;
  product: string;
  commissionAmount: number | null;
  archivedAt?: Date | null;
}

export interface SalesSummary {
  wonCount: number;
  lostCount: number;
  revenue: number; // realized: closed-won final amounts only
  averageDeal: number | null;
  openCount: number;
  pipelineValue: number; // estimated value of open opportunities — never mixed with revenue
  winRate: number | null; // won / (won + lost)
  commission: number;
}

/**
 * Sales math. Each opportunity is one row, counted once (ids are de-duplicated), and only
 * closed-won opportunities with a close date in range contribute to revenue.
 */
export function summarizeSales(opps: OppLike[], range?: { start: Date; end: Date }): SalesSummary {
  const seen = new Set<string>();
  const rows = opps.filter((o) => !o.archivedAt && !seen.has(o.id) && seen.add(o.id));
  const inRange = (d: Date | null) => !range || (d !== null && d >= range.start && d < range.end);
  const won = rows.filter((o) => o.status === "WON" && inRange(o.closedAt));
  const lost = rows.filter((o) => o.status === "LOST" && inRange(o.closedAt));
  const open = rows.filter((o) => OPEN_OPPORTUNITY_STATUSES.includes(o.status));
  const revenue = round2(won.reduce((s, o) => s + (o.finalAmount ?? 0), 0));
  return {
    wonCount: won.length,
    lostCount: lost.length,
    revenue,
    averageDeal: won.length ? round2(revenue / won.length) : null,
    openCount: open.length,
    pipelineValue: round2(open.reduce((s, o) => s + (o.estimatedValue ?? 0), 0)),
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
    commission: round2(won.reduce((s, o) => s + (o.commissionAmount ?? 0), 0)),
  };
}

/** Lead-to-sale conversion: distinct leads with a won sale / leads created in the period. */
export function conversionRate(leadsInPeriod: number, wonLeadIds: string[]): number | null {
  if (leadsInPeriod <= 0) return null;
  return new Set(wonLeadIds).size / leadsInPeriod;
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Commission = explicit amount, else rate × final amount; null when neither is set (no assumed rules). */
export function computeCommission(finalAmount: number | null, rate: number | null, explicit: number | null): number | null {
  if (explicit !== null && explicit !== undefined) return round2(explicit);
  if (rate !== null && rate !== undefined && finalAmount !== null) return round2(finalAmount * rate);
  return null;
}

export function groupSum<T>(rows: T[], key: (r: T) => string, value: (r: T) => number): { key: string; count: number; total: number }[] {
  const m = new Map<string, { count: number; total: number }>();
  for (const r of rows) {
    const k = key(r) || "—";
    const e = m.get(k) ?? { count: 0, total: 0 };
    e.count++;
    e.total = round2(e.total + value(r));
    m.set(k, e);
  }
  return [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.total - a.total || b.count - a.count);
}
