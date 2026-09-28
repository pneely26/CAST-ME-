import { parseDate, sanitizeUrl, sanitizeCell } from "../import/parse";
import { parseRegion, canonicalPlatform, type RegionCode } from "../constants";

/** Read a trimmed, sanitized, length-limited string from FormData. */
export function fstr(fd: FormData, key: string, max = 500): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const s = sanitizeCell(v).slice(0, max);
  return s ? s : null;
}

export function fdate(fd: FormData, key: string): Date | null {
  return parseDate(fstr(fd, key, 40));
}

export function furl(fd: FormData, key: string): string | null {
  return sanitizeUrl(fstr(fd, key, 1000));
}

export function fregion(fd: FormData, key = "region"): RegionCode | null {
  return parseRegion(fstr(fd, key, 60));
}

export function fplatform(fd: FormData, key = "platform"): string | null {
  const custom = fstr(fd, `${key}Custom`, 80);
  return canonicalPlatform(custom ?? fstr(fd, key, 80));
}

export function flist(fd: FormData, key: string): string[] {
  const raw = fstr(fd, key, 3000) ?? "";
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
}

export function fid(fd: FormData, key = "id"): string {
  const v = fstr(fd, key, 64);
  if (!v || !/^[a-z0-9]+$/i.test(v)) throw new Error("Invalid id");
  return v;
}
