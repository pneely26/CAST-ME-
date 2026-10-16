/**
 * Time-zone helpers built on Intl (no extra dependency). All instants are stored in UTC;
 * calendar days ("date keys", YYYY-MM-DD) and wall-clock times are interpreted in the
 * configured business time zone (America/Chicago by default).
 */
export const DEFAULT_TZ = "America/Chicago";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

export function zonedParts(date: Date, tz: string) {
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second };
}

/** Offset of tz from UTC at the given instant, in minutes (Chicago in summer: -300). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isDateKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
}

export function isTime(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Wall-clock date + time in tz -> UTC instant. Handles DST transitions. */
export function zonedToUtc(dateKey: string, time: string, tz: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMinutes(new Date(guess), tz);
  let result = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(result), tz);
  if (off2 !== off) {
    off = off2;
    result = guess - off * 60000;
  }
  return new Date(result);
}

export function dateKeyInTz(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function timeInTz(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function addDays(dateKey: string, n: number): string {
  const d = new Date(dateKey + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(dateKey: string): number {
  return new Date(dateKey + "T12:00:00Z").getUTCDay();
}

/** Monday-start week containing dateKey. */
export function weekStartKey(dateKey: string, weekStartsOn = 1): string {
  const wd = weekdayOf(dateKey);
  return addDays(dateKey, -((wd - weekStartsOn + 7) % 7));
}

export function monthStartKey(dateKey: string): string {
  return dateKey.slice(0, 8) + "01";
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86_400_000);
}

/** [start, end) in UTC covering the local calendar day(s) from startKey through endKey inclusive. */
export function dayRangeUtc(startKey: string, endKey: string, tz: string): { start: Date; end: Date } {
  return { start: zonedToUtc(startKey, "00:00", tz), end: zonedToUtc(addDays(endKey, 1), "00:00", tz) };
}

export type RangePreset = "today" | "week" | "month" | "custom" | "all";

export interface DateRange {
  preset: RangePreset;
  startKey: string;
  endKey: string;
  start: Date;
  end: Date;
  label: string;
}

/** Resolve a dashboard/report date filter. */
export function resolveRange(preset: string | undefined, from: string | undefined, to: string | undefined, tz: string, now = new Date()): DateRange {
  const today = dateKeyInTz(now, tz);
  let p = (["today", "week", "month", "custom", "all"].includes(preset ?? "") ? preset : "week") as RangePreset;
  let startKey = today;
  let endKey = today;
  if (p === "week") {
    startKey = weekStartKey(today);
    endKey = addDays(startKey, 6);
  } else if (p === "month") {
    startKey = monthStartKey(today);
    const next = new Date(startKey + "T12:00:00Z");
    next.setUTCMonth(next.getUTCMonth() + 1);
    endKey = addDays(next.toISOString().slice(0, 10), -1);
  } else if (p === "custom") {
    if (isDateKey(from) && isDateKey(to) && from <= to) {
      startKey = from;
      endKey = to;
    } else p = "week";
    if (p === "week") {
      startKey = weekStartKey(today);
      endKey = addDays(startKey, 6);
    }
  } else if (p === "all") {
    startKey = "2000-01-01";
    endKey = addDays(today, 3650);
  }
  const { start, end } = dayRangeUtc(startKey, endKey, tz);
  const label =
    p === "today" ? "Today" : p === "week" ? "This week" : p === "month" ? "This month" : p === "all" ? "All time" : `${fmtDateKey(startKey)} – ${fmtDateKey(endKey)}`;
  return { preset: p, startKey, endKey, start, end, label };
}

export function fmtDateKey(key: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  return new Date(key + "T12:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export function fmtDate(date: Date | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { ...opts, timeZone: tz });
}

export function fmtTime(date: Date | null | undefined, tz: string): string {
  if (!date) return "—";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

export function fmtDateTime(date: Date | null | undefined, tz: string): string {
  if (!date) return "—";
  return `${fmtDate(date, tz, { month: "short", day: "numeric" })}, ${fmtTime(date, tz)}`;
}

export function relativeDay(date: Date, tz: string, now = new Date()): string {
  const d = daysBetween(dateKeyInTz(now, tz), dateKeyInTz(date, tz));
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

/** "HH:mm" -> "9:00 AM" */
export function fmtClock(t: string | null | undefined): string {
  if (!t || !isTime(t)) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
