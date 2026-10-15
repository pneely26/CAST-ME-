"use server";

import { revalidatePath } from "next/cache";
import type { Visibility } from "@prisma/client";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { createBreakdown } from "@/lib/server/records";
import { updateBreakdownRelevance } from "@/lib/server/profile";
import { rerunUnreviewed, runDetection } from "@/lib/server/detection";
import { generateAlerts } from "@/lib/alerts/engine";
import { parseAgencyText, parseListingText, type ParsedAgencySubmission, type ParsedListing } from "@/lib/listing/parse";
import { canonicalPlatform, parseRegion } from "@/lib/constants";
import { parseDate, sanitizeCell, sanitizeUrl } from "@/lib/import/parse";
import { normalizedTitleString } from "@/lib/normalize";

const MAX_TEXT = 50_000;

function str(v: unknown, max = 300): string | null {
  const s = sanitizeCell(typeof v === "string" ? v : "").slice(0, max);
  return s ? s : null;
}

export async function parsePastedAction(
  text: string,
  mode: "LISTING" | "AGENCY",
  subject?: string | null,
): Promise<{ ok: true; listing?: ParsedListing; agency?: ParsedAgencySubmission } | { ok: false; error: string }> {
  await requireUser();
  const t = String(text ?? "").slice(0, MAX_TEXT);
  if (t.trim().length < 10) return { ok: false, error: "Paste the listing or email text first." };
  if (mode === "AGENCY") return { ok: true, agency: parseAgencyText(t, { subject: str(subject, 300) }) };
  return { ok: true, listing: parseListingText(t, { subject: str(subject, 300) }) };
}

async function markEmail(emailId: unknown, ids: string[]) {
  const id = str(emailId, 64);
  if (!id || !/^[a-z0-9]+$/i.test(id)) return;
  await prisma.emailMessage.updateMany({ where: { id }, data: { status: "ACCEPTED", createdIds: ids } });
}

export interface ListingSave {
  project: string;
  productionType?: string;
  platform?: string;
  union?: string;
  castingDirector?: string;
  castingOffice?: string;
  region?: string;
  deadline?: string;
  postedDate?: string;
  source: string;
  sourceUrl?: string;
  verified?: boolean;
  roles: { roleName?: string; roleType?: string; ageRange?: string; gender?: string; ethnicity?: string; description?: string }[];
  emailId?: string;
}

export async function saveListingAction(p: ListingSave): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  await requireUser();
  const project = str(p.project, 300);
  const source = str(p.source, 200);
  if (!project) return { ok: false, error: "Project title is required." };
  if (!source) return { ok: false, error: "Source is required (where you saw this)." };
  const roles = (Array.isArray(p.roles) ? p.roles : []).slice(0, 30);
  const list = roles.length ? roles : [{}];
  const ids: string[] = [];
  let projectId: string | null = null;
  for (const r of list) {
    const b = await createBreakdown({
      projectId,
      project,
      platform: canonicalPlatform(str(p.platform, 80)),
      productionType: str(p.productionType, 100),
      unionStatus: str(p.union, 100),
      region: parseRegion(str(p.region, 40)),
      castingDirector: str(p.castingDirector, 300),
      castingOffice: str(p.castingOffice, 200),
      roleName: str(r.roleName, 200),
      roleType: str(r.roleType, 100),
      ageRange: str(r.ageRange, 60),
      gender: str(r.gender, 60),
      ethnicity: str(r.ethnicity, 200),
      characterDescription: str(r.description, 4000),
      postedDate: parseDate(str(p.postedDate, 20)),
      submissionDeadline: parseDate(str(p.deadline, 20)),
      visibility: "PUBLIC" as Visibility,
      source,
      sourceUrl: sanitizeUrl(str(p.sourceUrl, 1000)),
      verified: Boolean(p.verified),
    });
    projectId = b.projectId; // all roles share one project
    ids.push(b.id);
  }
  await updateBreakdownRelevance(ids);
  await audit("CREATE", "PublicBreakdown", ids[0], `Added ${ids.length} role(s) from pasted text: ${project}`, { source });
  await markEmail(p.emailId, ids);
  await rerunUnreviewed();
  await generateAlerts();
  revalidatePath("/", "layout");
  return { ok: true, ids };
}

export interface AgencySave {
  project: string;
  role?: string;
  castingDirector?: string;
  platform?: string;
  region?: string;
  union?: string;
  status?: string;
  dateSubmitted?: string;
  notes?: string;
  emailId?: string;
}

export async function saveAgencyAction(p: AgencySave): Promise<{ ok: true; blindSpotId: string } | { ok: false; error: string }> {
  await requireUser();
  const project = str(p.project, 300);
  if (!project) return { ok: false, error: "Project is required." };
  const s = await prisma.agencySubmission.create({
    data: {
      projectTitleRaw: project,
      normalizedTitle: normalizedTitleString(project),
      role: str(p.role, 200),
      castingDirectorRaw: str(p.castingDirector, 300),
      platform: canonicalPlatform(str(p.platform, 80)),
      region: parseRegion(str(p.region, 40)),
      unionStatus: str(p.union, 100),
      status: str(p.status, 100),
      dateSubmitted: parseDate(str(p.dateSubmitted, 20)),
      notes: str(p.notes, 4000),
      source: p.emailId ? "Agency email" : "Agency report (pasted)",
    },
  });
  await audit("CREATE", "AgencySubmission", s.id, `Added agency submission from pasted text: ${project}`);
  const bs = await runDetection(s.id);
  await markEmail(p.emailId, [s.id]);
  await generateAlerts();
  revalidatePath("/", "layout");
  return { ok: true, blindSpotId: bs.id };
}
