import { addDays, weekdayOf } from "../time";

export interface TemplateDayLike {
  id: string;
  weekday: number;
  label: string | null;
  territoryId: string | null;
  areaId: string | null;
  startTime: string | null;
  endTime: string | null;
  visitTarget: number | null;
  notes: string | null;
}

export interface DayPlanLike {
  id: string;
  date: string;
  label: string | null;
  territoryId: string | null;
  areaId: string | null;
  startTime: string | null;
  endTime: string | null;
  visitTarget: number | null;
  routeNotes: string | null;
  status: string;
  isOverride: boolean;
}

export interface ResolvedDay {
  date: string;
  source: "plan" | "template" | "none";
  planId: string | null;
  templateDayId: string | null;
  label: string | null;
  territoryId: string | null;
  areaId: string | null;
  startTime: string | null;
  endTime: string | null;
  visitTarget: number | null;
  notes: string | null;
  status: string;
  isOverride: boolean;
}

/**
 * The plan for each date: a saved day plan wins (it may be a one-off override); otherwise the
 * recurring weekly template supplies the territory. Changing the template never alters saved
 * day plans, so overrides for specific dates are preserved.
 */
export function resolveWeek(startKey: string, days: number, template: TemplateDayLike[], plans: DayPlanLike[]): ResolvedDay[] {
  const out: ResolvedDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(startKey, i);
    const plan = plans.find((p) => p.date === date);
    if (plan) {
      out.push({ date, source: "plan", planId: plan.id, templateDayId: null, label: plan.label, territoryId: plan.territoryId, areaId: plan.areaId, startTime: plan.startTime, endTime: plan.endTime, visitTarget: plan.visitTarget, notes: plan.routeNotes, status: plan.status, isOverride: plan.isOverride });
      continue;
    }
    const t = template.find((d) => d.weekday === weekdayOf(date));
    if (t) {
      out.push({ date, source: "template", planId: null, templateDayId: t.id, label: t.label, territoryId: t.territoryId, areaId: t.areaId, startTime: t.startTime, endTime: t.endTime, visitTarget: t.visitTarget, notes: t.notes, status: "PLANNED", isOverride: false });
    } else {
      out.push({ date, source: "none", planId: null, templateDayId: null, label: null, territoryId: null, areaId: null, startTime: null, endTime: null, visitTarget: null, notes: null, status: "PLANNED", isOverride: false });
    }
  }
  return out;
}

/** Does a saved plan differ from what the template would give? (marks it as an override) */
export function differsFromTemplate(plan: Pick<DayPlanLike, "territoryId" | "areaId" | "startTime" | "endTime" | "visitTarget" | "label">, t: TemplateDayLike | undefined): boolean {
  if (!t) return Boolean(plan.territoryId || plan.areaId || plan.label);
  return plan.territoryId !== t.territoryId || plan.areaId !== t.areaId || plan.startTime !== t.startTime || plan.endTime !== t.endTime || plan.visitTarget !== t.visitTarget || (plan.label ?? null) !== (t.label ?? null);
}
