import { prisma } from "./db";
import { audit } from "./audit";
import { publicDataImportAdapter, type PublicImportInput } from "../adapters/public-data-import";
import { validateAgencyRow, type ColumnMapping } from "../import/mapping";
import { findDuplicateBreakdown, findProjectCandidates } from "./records";
import { previewDetection, runDetection, rerunUnreviewed } from "./detection";
import { updateBreakdownRelevance } from "./profile";
import { generateAlerts } from "../alerts/engine";
import { isDuplicateSubmission, type SubmissionInput } from "../matching/blindspot";
import { normalizedTitleString } from "../normalize";
import { REGION_LABELS } from "../constants";

export interface PreviewRow {
  index: number;
  valid: boolean;
  errors: string[];
  summary: Record<string, string>;
  duplicate: { label: string; id?: string } | null;
  candidates: { projectId: string; title: string; score: number; verdict: string; conflicts: string[]; agencyReported?: boolean }[];
  suggestedDecision: string;
  classification?: string;
}

export interface PreviewResult {
  rowsFound: number;
  rowsValid: number;
  rowsInvalid: number;
  duplicates: number;
  potentialMatches: number;
  rows: PreviewRow[];
}

function fmt(d: Date | null) {
  return d ? d.toISOString().slice(0, 10) : "";
}

export async function previewPublicImport(input: PublicImportInput): Promise<PreviewResult> {
  const ctx = { now: new Date(), input };
  const raw = await publicDataImportAdapter.fetch(ctx);
  const rows: PreviewRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = publicDataImportAdapter.validate(publicDataImportAdapter.normalize(raw[i], i + 1, ctx));
    const v = item.value;
    let duplicate: PreviewRow["duplicate"] = null;
    let candidates: PreviewRow["candidates"] = [];
    let suggestedDecision = item.valid ? "new" : "skip";
    if (v) {
      const key = `${normalizedTitleString(v.project)}|${(v.role ?? "").toLowerCase()}|${fmt(v.date)}`;
      if (seen.has(key)) duplicate = { label: "Duplicate of an earlier row in this file" };
      seen.add(key);
      const dupe = await findDuplicateBreakdown(null, v.project, v.role, v.date);
      if (dupe) duplicate = { label: "Already in database (same project, role, posted date)", id: dupe.id };
      const found = await findProjectCandidates({ title: v.project, castingDirector: v.castingDirector, platform: v.platform, region: v.region, role: v.role, includeAgencyOnly: true });
      candidates = found.map((c) => ({ projectId: c.projectId, title: c.title, score: c.match.score, verdict: c.match.verdict, conflicts: c.match.conflicts, agencyReported: c.agencyReported }));
      const best = found[0];
      if (duplicate) suggestedDecision = "skip";
      else if (best && best.match.verdict === "LIKELY_MATCH") suggestedDecision = `attach:${best.projectId}`;
    }
    rows.push({
      index: i + 1,
      valid: item.valid,
      errors: item.errors,
      summary: v
        ? {
            Project: v.project,
            Role: v.role ?? "",
            "Casting Director": v.castingDirector ?? "",
            Platform: v.platform ?? "",
            Region: v.region ? REGION_LABELS[v.region] : "",
            Deadline: fmt(v.deadline),
            Source: v.source,
          }
        : { Project: raw[i][input.mapping.project ?? ""] ?? "" },
      duplicate,
      candidates,
      suggestedDecision,
    });
  }
  return summarize(rows);
}

function summarize(rows: PreviewRow[]): PreviewResult {
  return {
    rowsFound: rows.length,
    rowsValid: rows.filter((r) => r.valid).length,
    rowsInvalid: rows.filter((r) => !r.valid).length,
    duplicates: rows.filter((r) => r.duplicate).length,
    potentialMatches: rows.filter((r) => r.candidates.length > 0).length,
    rows,
  };
}

export async function commitPublicImport(
  input: PublicImportInput & { fileName: string },
  decisions: Record<number, string>,
  confirmOverwrite: boolean,
  markVerified: boolean,
) {
  const ctx = { now: new Date(), input };
  const raw = await publicDataImportAdapter.fetch(ctx);
  const items = raw.map((r, i) => publicDataImportAdapter.validate(publicDataImportAdapter.normalize(r, i + 1, ctx)));
  const summary = await publicDataImportAdapter.save(items, ctx, { decisions, confirmOverwrite, markVerified });
  await updateBreakdownRelevance(summary.createdIds);
  // New public data may resolve earlier potential blind spots.
  await rerunUnreviewed();
  await generateAlerts();
  const valid = items.filter((i) => i.valid).length;
  await prisma.importBatch.create({
    data: {
      kind: "PUBLIC_BREAKDOWN",
      fileName: input.fileName,
      adapterId: publicDataImportAdapter.id,
      rowsFound: items.length,
      rowsValid: valid,
      rowsInvalid: items.length - valid,
      duplicates: Object.values(decisions).filter((d) => d === "skip").length,
      imported: summary.saved,
    },
  });
  await audit("IMPORT", "PublicBreakdown", null, `Imported ${summary.saved} public breakdown(s) from ${input.fileName}`, {
    saved: summary.saved,
    skipped: summary.skipped,
    errors: summary.errors.slice(0, 50),
  });
  return summary;
}

export interface AgencyImportInput {
  rows: Record<string, string>[];
  mapping: ColumnMapping;
}

export async function previewAgencyImport(input: AgencyImportInput): Promise<PreviewResult> {
  const validated = input.rows.map((r, i) => validateAgencyRow(r, input.mapping, i + 1));
  const inputs: SubmissionInput[] = validated.map((v) => ({
    projectTitleRaw: v.value?.project ?? "",
    role: v.value?.role,
    castingDirectorRaw: v.value?.castingDirector,
    dateSubmitted: v.value?.dateSubmitted,
    platform: v.value?.platform,
    region: v.value?.region,
  }));
  const existing = await prisma.agencySubmission.findMany();
  const detections = await previewDetection(inputs.filter((_, i) => validated[i].valid));
  let di = 0;
  const rows: PreviewRow[] = validated.map((v, i): PreviewRow => {
    if (!v.valid || !v.value) {
      return { index: v.index, valid: false, errors: v.errors, summary: { Project: v.raw[input.mapping.project ?? ""] ?? "" }, duplicate: null, candidates: [], suggestedDecision: "skip" };
    }
    const det = detections[di++];
    const dbDup = existing.find((e) =>
      isDuplicateSubmission(inputs[i], { projectTitleRaw: e.projectTitleRaw, role: e.role, dateSubmitted: e.dateSubmitted }),
    );
    const fileDup = inputs.slice(0, i).some((prev, j) => validated[j].valid && isDuplicateSubmission(inputs[i], prev));
    const duplicate = dbDup
      ? { label: "Already in database (same project, role, similar date)", id: dbDup.id }
      : fileDup
        ? { label: "Duplicate of an earlier row in this file" }
        : null;
    return {
      index: v.index,
      valid: true,
      errors: [],
      summary: {
        "Date Submitted": fmt(v.value.dateSubmitted),
        Project: v.value.project,
        Role: v.value.role ?? "",
        "Casting Director": v.value.castingDirector ?? "",
        Platform: v.value.platform ?? "",
        Region: v.value.region ? REGION_LABELS[v.value.region] : "",
        Status: v.value.status ?? "",
      },
      duplicate,
      candidates: det.candidates.map((c) => ({ projectId: c.projectId, title: c.title, score: c.match.score, verdict: c.match.verdict, conflicts: c.match.conflicts })),
      classification: duplicate ? "POSSIBLE_DUPLICATE" : det.classification,
      suggestedDecision: duplicate ? "skip" : "import",
    };
  });
  return summarize(rows);
}

export async function commitAgencyImport(input: AgencyImportInput & { fileName: string }, decisions: Record<number, string>) {
  const validated = input.rows.map((r, i) => validateAgencyRow(r, input.mapping, i + 1));
  const created: string[] = [];
  let skipped = 0;
  for (const v of validated) {
    const decision = decisions[v.index] ?? "import";
    if (!v.valid || !v.value || decision === "skip") {
      skipped++;
      continue;
    }
    const s = await prisma.agencySubmission.create({
      data: {
        projectTitleRaw: v.value.project,
        normalizedTitle: normalizedTitleString(v.value.project),
        role: v.value.role,
        castingDirectorRaw: v.value.castingDirector,
        dateSubmitted: v.value.dateSubmitted,
        platform: v.value.platform,
        region: v.value.region,
        unionStatus: v.value.union,
        status: v.value.status,
        notes: v.value.notes,
        source: "Agency report (import)",
        isDemo: /demo data/i.test(v.value.notes ?? ""),
      },
    });
    created.push(s.id);
  }
  for (const id of created) await runDetection(id);
  await generateAlerts();
  await prisma.importBatch.create({
    data: {
      kind: "AGENCY_SUBMISSION",
      fileName: input.fileName,
      adapterId: "AGENCY_SUBMISSION_IMPORT",
      rowsFound: validated.length,
      rowsValid: validated.filter((v) => v.valid).length,
      rowsInvalid: validated.filter((v) => !v.valid).length,
      duplicates: Object.values(decisions).filter((d) => d === "skip").length,
      imported: created.length,
    },
  });
  await audit("IMPORT", "AgencySubmission", null, `Imported ${created.length} agency submission(s) from ${input.fileName}`, { created: created.length, skipped });
  return { saved: created.length, skipped };
}
