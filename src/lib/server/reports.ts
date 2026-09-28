import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { prisma } from "./db";
import { getWatchlistActivity } from "./watchlist";
import { BLIND_SPOT_EXPLANATION, REGION_LABELS, type RegionCode } from "../constants";
import { escapeFormula } from "../import/parse";
import { sourceState, SOURCE_STATE_LABEL, daysUntil } from "../deadlines";

export interface ReportSection {
  title: string;
  note?: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface Report {
  title: string;
  periodLabel: string;
  generatedAt: Date;
  sections: ReportSection[];
}

const f = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const region = (r: string | null | undefined) => (r ? (REGION_LABELS[r as RegionCode] ?? r) : "");
const staleDays = () => Number(process.env.STALE_AFTER_DAYS ?? 14);

export async function weeklyReport(now = new Date()): Promise<Report> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const newPublic = await prisma.publicBreakdown.findMany({
    where: { importedAt: { gte: since } },
    include: { project: true },
    orderBy: { importedAt: "desc" },
  });
  const matches = newPublic.filter((b) => b.relevance === "HIGH" || b.relevance === "POSSIBLE");
  const subs = await prisma.agencySubmission.findMany({
    where: { OR: [{ importedAt: { gte: since } }, { dateSubmitted: { gte: since } }] },
    include: { blindSpot: true },
    orderBy: { dateSubmitted: "desc" },
  });
  const spots = await prisma.blindSpot.findMany({
    where: { classification: { in: ["AGENCY_REPORTED_NOT_FOUND", "NEEDS_REVIEW"] }, reviewStatus: { not: "DISMISSED" } },
    include: { project: true, agencySubmission: true },
    orderBy: { detectionDate: "desc" },
  });
  const watched = await prisma.watchlistItem.findMany({ where: { type: "CASTING_DIRECTOR" }, include: { castingDirector: { include: { castings: { include: { project: true } } } } } });
  const activity = await getWatchlistActivity(7, now);
  const deadlines = await prisma.publicBreakdown.findMany({
    where: { submissionDeadline: { gte: now, lte: new Date(now.getTime() + 14 * 86_400_000) }, visibility: { not: "CLOSED" } },
    include: { project: true },
    orderBy: { submissionDeadline: "asc" },
  });

  return {
    title: "Weekly Casting Report",
    periodLabel: `${f(since)} to ${f(now)}`,
    generatedAt: now,
    sections: [
      {
        title: "New public opportunities",
        columns: ["Project", "Role", "Platform", "Region", "Union", "Deadline", "Source", "Source status"],
        rows: newPublic.map((b) => [
          b.project.title,
          b.roleName ?? "",
          b.project.platform ?? "",
          region(b.region ?? b.project.region),
          b.unionStatus ?? b.project.unionStatus ?? "",
          f(b.submissionDeadline),
          b.source,
          SOURCE_STATE_LABEL[sourceState({ verifiedAt: b.verifiedAt, visibility: b.visibility, submissionDeadline: b.submissionDeadline, projectStatus: b.project.status }, now, staleDays())],
        ]),
      },
      {
        title: "Potential matches (explicit breakdown details only)",
        columns: ["Project", "Role", "Relevance", "Why"],
        rows: matches.map((b) => [
          b.project.title,
          b.roleName ?? "",
          b.relevance ?? "",
          ((b.relevanceDetails as { factors?: { outcome: string; detail: string }[] } | null)?.factors ?? [])
            .filter((x) => x.outcome === "MATCH" || x.outcome === "OPEN")
            .map((x) => x.detail)
            .join("; "),
        ]),
      },
      {
        title: "Agency submissions",
        columns: ["Date submitted", "Project", "Role", "Casting director", "Status", "Detection"],
        rows: subs.map((s) => [f(s.dateSubmitted), s.projectTitleRaw, s.role ?? "", s.castingDirectorRaw ?? "", s.status ?? "", s.blindSpot?.classification.replace(/_/g, " ") ?? ""]),
      },
      {
        title: "Potential blind spots",
        note: BLIND_SPOT_EXPLANATION,
        columns: ["Project", "Agency submission date", "Classification", "Review status"],
        rows: spots.map((s) => [s.project.title, f(s.agencySubmission?.dateSubmitted), s.classification.replace(/_/g, " "), s.reviewStatus.replace(/_/g, " ")]),
      },
      {
        title: "Watched casting directors",
        note: "Activity frequency only — not a ranking.",
        columns: ["Casting director", "Office", "Projects on file", "Activity this week"],
        rows: watched
          .filter((w) => w.castingDirector)
          .map((w) => [
            w.castingDirector!.name,
            w.castingDirector!.castingOffice ?? "",
            w.castingDirector!.castings.length,
            activity.filter((a) => a.watchId === w.id).length,
          ]),
      },
      {
        title: "Upcoming deadlines (next 14 days)",
        columns: ["Deadline", "Days left", "Project", "Role", "Source"],
        rows: deadlines.map((b) => [f(b.submissionDeadline), daysUntil(b.submissionDeadline!, now), b.project.title, b.roleName ?? "", b.source]),
      },
    ],
  };
}

function countBy<T>(items: T[], key: (t: T) => string): (string | number)[][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i) || "Not listed", (m.get(key(i) || "Not listed") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]);
}

export async function monthlyReport(year: number, month: number, now = new Date()): Promise<Report> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { discoveredAt: { gte: start, lt: end } },
        { breakdowns: { some: { OR: [{ importedAt: { gte: start, lt: end } }, { postedDate: { gte: start, lt: end } }] } } },
        { submissions: { some: { OR: [{ importedAt: { gte: start, lt: end } }, { dateSubmitted: { gte: start, lt: end } }] } } },
      ],
    },
    include: { breakdowns: true, submissions: true, castings: { include: { castingDirector: true } } },
  });
  const publicProjects = projects.filter((p) => p.breakdowns.length > 0);
  const agencyProjects = projects.filter((p) => p.submissions.length > 0);
  const spots = await prisma.blindSpot.count({
    where: { classification: { in: ["AGENCY_REPORTED_NOT_FOUND", "NEEDS_REVIEW"] }, reviewStatus: { not: "DISMISSED" }, detectionDate: { gte: start, lt: end } },
  });
  const submissions = await prisma.agencySubmission.count({
    where: { OR: [{ dateSubmitted: { gte: start, lt: end } }, { dateSubmitted: null, importedAt: { gte: start, lt: end } }] },
  });
  const matching = await prisma.publicBreakdown.count({
    where: { relevance: { in: ["HIGH", "POSSIBLE"] }, OR: [{ importedAt: { gte: start, lt: end } }, { postedDate: { gte: start, lt: end } }] },
  });
  const cdRows = new Map<string, number>();
  for (const p of projects) for (const c of p.castings) cdRows.set(c.castingDirector.name, (cdRows.get(c.castingDirector.name) ?? 0) + 1);

  const label = start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return {
    title: "Monthly Casting Report",
    periodLabel: label,
    generatedAt: now,
    sections: [
      {
        title: "Summary",
        columns: ["Metric", "Count"],
        rows: [
          ["Total projects", projects.length],
          ["Public projects", publicProjects.length],
          ["Agency-reported projects", agencyProjects.length],
          ["Potential blind spots", spots],
          ["Number of submissions", submissions],
          ["Public opportunities matching profile (HIGH/POSSIBLE)", matching],
        ],
      },
      { title: "Projects by platform", columns: ["Platform", "Projects"], rows: countBy(projects, (p) => p.platform ?? "") },
      { title: "Projects by region", columns: ["Region", "Projects"], rows: countBy(projects, (p) => region(p.region ?? p.breakdowns.find((b) => b.region)?.region)) },
      {
        title: "Projects by casting director",
        note: "Activity frequency only — not a ranking.",
        columns: ["Casting director", "Projects"],
        rows: [...cdRows.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]),
      },
    ],
  };
}

// ---------- exporters ----------

function csvCell(v: string | number): string {
  const s = typeof v === "number" ? String(v) : escapeFormula(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(r: Report): string {
  const lines: string[] = [csvCell(r.title), csvCell(`Period: ${r.periodLabel}`), csvCell(`Generated: ${r.generatedAt.toISOString()}`), ""];
  for (const s of r.sections) {
    lines.push(csvCell(s.title));
    if (s.note) lines.push(csvCell(s.note));
    lines.push(s.columns.map(csvCell).join(","));
    for (const row of s.rows) lines.push(row.map(csvCell).join(","));
    if (s.rows.length === 0) lines.push("(none)");
    lines.push("");
  }
  return "﻿" + lines.join("\r\n");
}

export async function reportToXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Stewart Blind Spot";
  wb.created = r.generatedAt;
  for (const s of r.sections) {
    const name = s.title.replace(/[\\/?*[\]:]/g, "").slice(0, 31);
    const ws = wb.addWorksheet(name);
    ws.addRow([r.title, r.periodLabel]).font = { bold: true };
    if (s.note) ws.addRow([s.note]).font = { italic: true };
    const header = ws.addRow(s.columns);
    header.font = { bold: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E5E4" } };
    for (const row of s.rows) ws.addRow(row.map((v) => (typeof v === "string" ? escapeFormula(v) : v)));
    ws.columns.forEach((c) => (c.width = 22));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.replace(/[^\x20-\x7E]/g, (ch) => ({ "—": "-", "–": "-", "“": '"', "”": '"', "’": "'", "·": "-" })[ch] ?? "?").split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export async function reportToPdf(r: Report): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${r.title} — ${r.periodLabel}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 792;
  const H = 612; // landscape letter
  const M = 36;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const ensure = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (t: string, x: number, size: number, f: PDFFont, color = rgb(0.1, 0.1, 0.12)) => page.drawText(wrap(t, f, size, 10000)[0], { x, y, size, font: f, color });

  text(r.title, M, 18, bold);
  y -= 20;
  text(`${r.periodLabel}  ·  generated ${r.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, M, 9, font, rgb(0.4, 0.4, 0.45));
  y -= 14;
  text("Personal research report. Contains private agency information - do not share publicly.", M, 8, font, rgb(0.55, 0.3, 0.1));
  y -= 22;

  for (const s of r.sections) {
    ensure(40);
    text(s.title, M, 12, bold);
    y -= 14;
    if (s.note) {
      text(s.note, M, 8, font, rgb(0.4, 0.4, 0.45));
      y -= 12;
    }
    const colW = (W - 2 * M) / s.columns.length;
    const drawRow = (cells: (string | number)[], f: PDFFont, size: number) => {
      const wrapped = cells.map((c) => wrap(String(c), f, size, colW - 6).slice(0, 4));
      const h = Math.max(...wrapped.map((w) => w.length)) * (size + 2) + 4;
      ensure(h);
      wrapped.forEach((lines, i) => lines.forEach((ln, j) => page.drawText(ln, { x: M + i * colW, y: y - j * (size + 2), size, font: f })));
      y -= h;
      page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
    };
    drawRow(s.columns, bold, 8);
    if (s.rows.length === 0) drawRow(["(none)"], font, 8);
    for (const row of s.rows) drawRow(row, font, 8);
    y -= 12;
  }
  return Buffer.from(await pdf.save());
}
