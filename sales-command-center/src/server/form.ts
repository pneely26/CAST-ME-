/** Helpers for reading FormData in server actions. Everything is re-validated by services. */
export function str(fd: FormData, k: string, max = 5000): string | undefined {
  const v = fd.get(k);
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\u0000/g, "").trim().slice(0, max);
  return s;
}

export function strOrNull(fd: FormData, k: string, max = 5000): string | null {
  const s = str(fd, k, max);
  return s ? s : null;
}

export function bool(fd: FormData, k: string): boolean {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1" || v === "yes";
}

export function ids(fd: FormData, k = "ids"): string[] {
  return fd
    .getAll(k)
    .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9]{10,40}$/i.test(s))
    .slice(0, 1000);
}

export function id(fd: FormData, k = "id"): string {
  const v = str(fd, k, 64);
  if (!v || !/^[a-z0-9]{10,40}$/i.test(v)) throw new Error("Missing or invalid id");
  return v;
}

export function tags(fd: FormData, k = "tags"): string[] {
  return (str(fd, k, 2000) ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export function int(fd: FormData, k: string): number | undefined {
  const s = str(fd, k, 20);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

import { isDateKey, isTime, zonedToUtc } from "@/lib/time";

/** Local date (+ optional time) fields -> UTC instant in the business time zone. */
export function zonedDate(fd: FormData, dateKey: string, timeKey: string | null, tz: string, defaultTime = "09:00"): Date | null {
  const d = str(fd, dateKey, 10);
  if (!d) return null;
  if (!isDateKey(d)) throw new Error("Invalid date");
  const t = timeKey ? str(fd, timeKey, 5) : undefined;
  return zonedToUtc(d, t && isTime(t) ? t : defaultTime, tz);
}
