import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { monthlyReport, reportToCsv, reportToPdf, reportToXlsx, weeklyReport } from "@/lib/server/reports";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { kind } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "csv";
  let report;
  if (kind === "weekly") report = await weeklyReport();
  else if (kind === "monthly") {
    const m = /^(\d{4})-(\d{2})$/.exec(url.searchParams.get("month") ?? "");
    const now = new Date();
    const year = m ? Number(m[1]) : now.getUTCFullYear();
    const month = m ? Number(m[2]) : now.getUTCMonth() + 1;
    if (month < 1 || month > 12) return NextResponse.json({ error: "Invalid month" }, { status: 400 });
    report = await monthlyReport(year, month);
  } else return NextResponse.json({ error: "Unknown report" }, { status: 404 });

  const base = `stewart-${kind}-report-${report.periodLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const headers = { "Cache-Control": "private, no-store" };
  if (format === "csv") {
    return new NextResponse(reportToCsv(report), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` } });
  }
  if (format === "xlsx") {
    const buf = await reportToXlsx(report);
    return new NextResponse(new Uint8Array(buf), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` } });
  }
  if (format === "pdf") {
    const buf = await reportToPdf(report);
    return new NextResponse(new Uint8Array(buf), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
  }
  return NextResponse.json({ error: "Unknown format" }, { status: 400 });
}
