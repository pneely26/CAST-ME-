import Papa from "papaparse";
import ExcelJS from "exceljs";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
const MAX_CELL = 5000;

export type FileKind = "csv" | "xlsx" | "json";

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
}

export class ImportError extends Error {}

export function detectKind(fileName: string, allowed: FileKind[]): FileKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const kind = ext === "csv" ? "csv" : ext === "xlsx" ? "xlsx" : ext === "json" ? "json" : null;
  if (!kind || !allowed.includes(kind)) {
    throw new ImportError(`Unsupported file type ".${ext}". Allowed: ${allowed.map((k) => "." + k).join(", ")}`);
  }
  return kind;
}

/** Remove control characters, trim, and cap length. */
export function sanitizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) s = isNaN(value.getTime()) ? "" : value.toISOString();
  else if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("text" in v) s = String(v.text);
    else if ("result" in v) s = sanitizeCell(v.result);
    else if ("richText" in v && Array.isArray(v.richText)) s = v.richText.map((r: { text?: string }) => r.text ?? "").join("");
    else if ("hyperlink" in v) s = String(v.hyperlink);
    else s = "";
  } else s = String(value);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return s.length > MAX_CELL ? s.slice(0, MAX_CELL) : s;
}

function sanitizeHeader(h: unknown, i: number): string {
  const s = sanitizeCell(h).replace(/\s+/g, " ");
  return s || `Column ${i + 1}`;
}

function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n ? `${h} (${n + 1})` : h;
  });
}

export function parseCsv(text: string): ParsedTable {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const data = res.data as unknown[][];
  if (data.length === 0) return { headers: [], rows: [] };
  const headers = uniqueHeaders(data[0].map(sanitizeHeader));
  const rows = data.slice(1, MAX_ROWS + 1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => (o[h] = sanitizeCell(r[i])));
    return o;
  });
  if (data.length - 1 > MAX_ROWS) throw new ImportError(`Too many rows (max ${MAX_ROWS}).`);
  return { headers, rows: rows.filter((r) => Object.values(r).some(Boolean)) };
}

export async function parseXlsx(buf: ArrayBuffer | Buffer): Promise<ParsedTable> {
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs accepts Buffer/ArrayBuffer
    await wb.xlsx.load(buf as ArrayBuffer);
  } catch {
    throw new ImportError("Could not read XLSX file. Is it a valid Excel workbook?");
  }
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const matrix: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];
    matrix.push(values.slice(1));
  });
  if (matrix.length === 0) return { headers: [], rows: [] };
  if (matrix.length - 1 > MAX_ROWS) throw new ImportError(`Too many rows (max ${MAX_ROWS}).`);
  const width = Math.max(...matrix.map((r) => r.length));
  const headers = uniqueHeaders(Array.from({ length: width }, (_, i) => sanitizeHeader(matrix[0][i], i)));
  const rows = matrix.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      const v = r[i];
      o[h] = v instanceof Date ? v.toISOString().slice(0, 10) : sanitizeCell(v);
    });
    return o;
  });
  return { headers, rows: rows.filter((r) => Object.values(r).some(Boolean)) };
}

export function parseJson(text: string): ParsedTable {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError("Invalid JSON.");
  }
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).rows)
      ? ((data as Record<string, unknown>).rows as unknown[])
      : data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).breakdowns)
        ? ((data as Record<string, unknown>).breakdowns as unknown[])
        : null;
  if (!arr) throw new ImportError("JSON must be an array of objects (or { rows: [...] }).");
  if (arr.length > MAX_ROWS) throw new ImportError(`Too many rows (max ${MAX_ROWS}).`);
  const headerSet = new Set<string>();
  for (const item of arr) if (item && typeof item === "object" && !Array.isArray(item)) Object.keys(item).forEach((k) => headerSet.add(k));
  const headers = [...headerSet].map((h, i) => sanitizeHeader(h, i));
  const keys = [...headerSet];
  const rows = arr
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const o: Record<string, string> = {};
      keys.forEach((k, i) => (o[headers[i]] = sanitizeCell((item as Record<string, unknown>)[k])));
      return o;
    });
  return { headers, rows };
}

export async function parseUpload(fileName: string, buf: ArrayBuffer, allowed: FileKind[]): Promise<ParsedTable & { kind: FileKind }> {
  if (buf.byteLength > MAX_UPLOAD_BYTES) throw new ImportError("File is larger than 5 MB.");
  if (buf.byteLength === 0) throw new ImportError("File is empty.");
  const kind = detectKind(fileName, allowed);
  if (kind === "xlsx") {
    // XLSX files are ZIP archives: check magic bytes
    const sig = new Uint8Array(buf.slice(0, 2));
    if (sig[0] !== 0x50 || sig[1] !== 0x4b) throw new ImportError("File does not look like a valid .xlsx workbook.");
    return { kind, ...(await parseXlsx(buf)) };
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (text.includes("\u0000")) throw new ImportError("File appears to be binary, not text.");
  return { kind, ...(kind === "csv" ? parseCsv(text) : parseJson(text)) };
}

/** Parse many date formats. Returns null if unparseable/blank. */
export function parseDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  // Excel serial date
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 20000 && serial < 80000) return new Date(Math.round((serial - 25569) * 86_400_000));
  }
  // ISO yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const hasTime = /T\d{2}:\d{2}/.test(s);
    if (hasTime) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    return utcNoon(+m[1], +m[2], +m[3]);
  }
  // US m/d/yyyy or m/d/yy
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return utcNoon(y, +m[1], +m[2]);
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return utcNoon(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function utcNoon(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  if (date.getUTCMonth() !== mo - 1) return null;
  return date;
}

/** Only allow http(s) URLs. */
export function sanitizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Prevent CSV/Excel formula injection when exporting user-controlled text. */
export function escapeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
