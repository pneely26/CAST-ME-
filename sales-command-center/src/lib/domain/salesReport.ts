/**
 * Reading a "BC History" sales report (PDF) into sales rows.
 *
 * The PDF is turned into positioned text and check-box marks by the server (src/server/pdf.ts); this module
 * only works on those positions, so it can be tested without a PDF. Values are kept exactly as printed —
 * RVOL / AVOL are not money and are never turned into a sale amount.
 */

export interface PdfItem {
  str: string;
  x: number; // left edge, points from the left of the page
  y: number; // baseline, points from the top of the page
  w?: number; // width in points
}
export interface PdfMark {
  x: number;
  y: number; // top edge, points from the top of the page
  w: number;
  h: number;
  checked: boolean;
}
export interface PdfPageContent {
  items: PdfItem[];
  marks: PdfMark[];
}

export const REPORT_COLUMNS = ["pn", "src", "company", "rvol", "avol", "signed44", "confirmer", "salesRep", "analyst", "apptDate", "saleDate", "runDate", "surveyResult", "msStatus", "notes"] as const;
type Column = (typeof REPORT_COLUMNS)[number];

/** Header text → column, and how far left of the header text a column's values can start. */
const HEADERS: Record<string, { col: Column; offset: number }> = {
  "PN/Job #": { col: "pn", offset: -12 },
  SRC: { col: "src", offset: -3 },
  COMPANY: { col: "company", offset: -8 },
  RVOL: { col: "rvol", offset: -2 },
  AVOL: { col: "avol", offset: -2 },
  "44": { col: "signed44", offset: -3 },
  Confirmer: { col: "confirmer", offset: -4 },
  "Sales Rep": { col: "salesRep", offset: -7 },
  Analyst: { col: "analyst", offset: -10 },
  "Appt Date": { col: "apptDate", offset: -1 },
  "Sale Date": { col: "saleDate", offset: -3 },
  "Run Date": { col: "runDate", offset: -3 },
  "Survey Result": { col: "surveyResult", offset: -16 },
  // survey sub-columns run up to the MS Status header, so MS values start a little right of it
  "MS Status": { col: "msStatus", offset: 8 },
  Notes: { col: "notes", offset: -4 },
};
const REQUIRED: Column[] = ["pn", "company", "salesRep", "saleDate"];

export interface ReportRow {
  rowNumber: number;
  page: number;
  pn: string; // prospect #
  job: string; // job # after the dash
  src: string;
  company: string;
  rvol: string;
  avol: string;
  signed44: boolean | null; // null when no check box was found on the row
  confirmer: string;
  salesRep: string;
  analyst: string;
  apptDate: string | null; // YYYY-MM-DD
  saleDate: string | null;
  runDate: string | null;
  surveyResult: string;
  msStatus: string;
  notes: string;
}

export interface ParsedReport {
  title: string | null;
  generatedOn: string | null;
  period: string | null;
  rows: ReportRow[];
  problems: string[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** "7/15/2026" → "2026-07-15"; anything else → null. */
export function reportDate(s: string): string | null {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "Mozzano, Louis" → "Louis Mozzano" (names in the report are "Last, First"). */
export function reportPersonName(s: string): string {
  const t = clean(s).replace(/,$/, "");
  const m = t.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : t;
}

/** Group items into printed lines (same baseline, within a couple of points). */
function lines(items: PdfItem[]): PdfItem[][] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const out: PdfItem[][] = [];
  for (const it of sorted) {
    const cur = out[out.length - 1];
    if (cur && Math.abs(cur[0].y - it.y) <= 2.5) cur.push(it);
    else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.x - b.x));
}

export function parseSalesReport(pages: PdfPageContent[]): ParsedReport {
  const problems: string[] = [];
  const rows: ReportRow[] = [];
  let title: string | null = null;
  let generatedOn: string | null = null;
  let period: string | null = null;
  let sawHeader = false;

  pages.forEach((page, pi) => {
    const ls = lines(page.items);
    for (const l of ls) {
      const text = clean(l.map((i) => i.str).join(" "));
      if (!title && /^BC History$/i.test(text)) title = text;
      if (!generatedOn && /^Generated on:/i.test(text)) generatedOn = clean(text.replace(/^Generated on:/i, ""));
      if (!period && /^All Sales:/i.test(text)) period = clean(text.replace(/^All Sales:/i, ""));
    }
    // header line: the one carrying most of the known column titles
    let header: PdfItem[] | null = null;
    for (const l of ls) {
      const hits = l.filter((i) => HEADERS[clean(i.str)]);
      if (hits.length >= 6 && (!header || hits.length > header.length)) header = hits;
    }
    if (!header) return;
    const starts = header.map((i) => ({ col: HEADERS[clean(i.str)].col, x: i.x + HEADERS[clean(i.str)].offset })).sort((a, b) => a.x - b.x);
    const missing = REQUIRED.filter((c) => !starts.some((s) => s.col === c));
    if (missing.length) {
      problems.push(`Page ${pi + 1}: the column header is missing ${missing.join(", ")} — page skipped.`);
      return;
    }
    sawHeader = true;
    const headerY = header[0].y;
    const firstX = starts[0].x;
    const colAt = (x: number): Column | null => {
      let c: Column | null = null;
      for (const s of starts) if (x >= s.x) c = s.col;
      return c;
    };
    const c44 = starts.find((s) => s.col === "signed44");
    const after44 = c44 ? starts.find((s) => s.x > c44.x) : undefined;

    // Walk the text in drawing order: each row starts with its row number, and a cell's text that overflows
    // its box is drawn (clipped, invisible) a line lower — on top of the next row. Only text on the row's own
    // baseline is visible, so anything else drawn while a row is open is dropped.
    const rowsOnPage: { y: number; num: string; items: PdfItem[] }[] = [];
    for (const it of page.items) {
      if (!it.str.trim() || it.y <= headerY + 2) continue;
      const cur = rowsOnPage[rowsOnPage.length - 1];
      if (it.x < firstX && /^\d{1,5}$/.test(it.str.trim()) && (!cur || Math.abs(cur.y - it.y) > 2)) {
        rowsOnPage.push({ y: it.y, num: it.str.trim(), items: [] });
        continue;
      }
      if (cur && Math.abs(cur.y - it.y) <= 2) cur.items.push(it);
    }

    for (const row of rowsOnPage) {
      const cells = Object.fromEntries(REPORT_COLUMNS.map((c) => [c, [] as string[]])) as Record<Column, string[]>;
      // a cell's text is placed by its middle: some columns are centered, so long names start left of the header
      for (const it of [...row.items].sort((a, b) => a.x - b.x)) {
        const c = colAt(it.x + (it.w ?? 0) / 2);
        if (c) cells[c].push(it.str);
      }
      const v = (c: Column) => clean(cells[c].join(" "));
      const pnJob = v("pn").match(/^(\d+)\s*-\s*(\d+)$/);
      if (!pnJob) {
        problems.push(`Page ${pi + 1}, row ${row.num}: couldn't read the PN/Job # (“${v("pn")}”) — row skipped.`);
        continue;
      }
      const y = row.y;
      const mark = c44 ? page.marks.find((m) => m.x >= c44.x - 4 && m.x < (after44?.x ?? c44.x + 20) && y >= m.y - 2 && y <= m.y + m.h + 2) : undefined;
      rows.push({
        rowNumber: Number(row.num),
        page: pi + 1,
        pn: pnJob[1],
        job: pnJob[2],
        src: v("src"),
        company: v("company"),
        rvol: v("rvol"),
        avol: v("avol"),
        signed44: mark ? mark.checked : null,
        confirmer: v("confirmer").replace(/,$/, ""),
        salesRep: v("salesRep").replace(/,$/, ""),
        analyst: v("analyst").replace(/,$/, ""),
        apptDate: reportDate(v("apptDate")),
        saleDate: reportDate(v("saleDate")),
        runDate: reportDate(v("runDate")),
        surveyResult: v("surveyResult"),
        msStatus: v("msStatus"),
        notes: v("notes"),
      });
    }
  });
  if (!sawHeader) problems.unshift("This doesn't look like a BC History sales report — no column header (PN/Job #, COMPANY, Sales Rep, Sale Date…) was found.");
  return { title, generatedOn, period, rows, problems };
}

/** One sale = one PN/Job #. A job can take several report lines (one per survey result line). */
export interface ReportSale {
  ref: string; // "218263345-2"
  pn: string;
  job: string;
  company: string;
  salesRep: string; // "Mozzano, Louis" as printed
  signed44: boolean;
  apptDate: string | null;
  saleDate: string | null;
  runDate: string | null;
  goStatus: string | null; // the Survey Result line(s), as printed
  details: Record<string, string>;
  rowNumbers: number[];
}

export function groupReportSales(rows: ReportRow[]): ReportSale[] {
  const by = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = `${r.pn}-${r.job}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()].map(([ref, rs]) => {
    const first = rs[0];
    const uniq = (f: (r: ReportRow) => string) => [...new Set(rs.map(f).filter(Boolean))].join(" | ");
    const details: Record<string, string> = {
      "Report rows": rs.map((r) => r.rowNumber).join(", "),
      SRC: uniq((r) => r.src),
      RVOL: uniq((r) => r.rvol),
      AVOL: uniq((r) => r.avol),
      Confirmer: uniq((r) => r.confirmer),
      "Sales Rep": uniq((r) => r.salesRep),
      Analyst: uniq((r) => r.analyst),
      "Appt Date": uniq((r) => r.apptDate ?? ""),
      "MS Status": uniq((r) => r.msStatus),
      Notes: uniq((r) => r.notes),
      "Company (as printed)": uniq((r) => r.company),
    };
    for (const k of Object.keys(details)) if (!details[k]) delete details[k];
    const survey = rs.map((r) => r.surveyResult).filter(Boolean);
    return {
      ref,
      pn: first.pn,
      job: first.job,
      company: first.company,
      salesRep: first.salesRep,
      signed44: rs.some((r) => r.signed44 === true),
      apptDate: first.apptDate,
      saleDate: rs.find((r) => r.saleDate)?.saleDate ?? null,
      runDate: rs.find((r) => r.runDate)?.runDate ?? null,
      goStatus: survey.length ? survey.join(" | ").slice(0, 300) : null,
      details,
      rowNumbers: rs.map((r) => r.rowNumber),
    };
  });
}
