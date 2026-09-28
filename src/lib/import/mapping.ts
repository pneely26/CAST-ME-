import { basicFold } from "../normalize";
import { canonicalPlatform, parseRegion, type RegionCode } from "../constants";
import { parseDate, sanitizeUrl } from "./parse";

export type ImportKind = "PUBLIC_BREAKDOWN" | "AGENCY_SUBMISSION";

export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
}

export const PUBLIC_FIELDS: FieldDef[] = [
  { key: "project", label: "Project", required: true, aliases: ["project", "project title", "title", "production", "show", "project name"] },
  { key: "castingDirector", label: "Casting Director", aliases: ["casting director", "cd", "casting", "casting directors", "director of casting"] },
  { key: "castingOffice", label: "Casting Office", aliases: ["casting office", "office", "casting company"] },
  { key: "role", label: "Role", aliases: ["role", "role name", "character", "part"] },
  { key: "roleType", label: "Role Type", aliases: ["role type", "type of role", "billing", "role size"] },
  { key: "characterDescription", label: "Character Description", aliases: ["character description", "description", "role description", "breakdown"] },
  { key: "ageRange", label: "Age Range", aliases: ["age", "age range", "ages", "playing age"] },
  { key: "gender", label: "Gender", aliases: ["gender", "sex"] },
  { key: "ethnicity", label: "Ethnicity (as stated)", aliases: ["ethnicity", "ethnicities", "race", "ethnic appearance"] },
  { key: "date", label: "Date Posted", aliases: ["date", "posted", "date posted", "posted date", "release date"] },
  { key: "deadline", label: "Deadline", aliases: ["deadline", "submission deadline", "due", "due date", "submit by"] },
  { key: "region", label: "Region", aliases: ["region", "market", "location", "casting region", "area"] },
  { key: "union", label: "Union", aliases: ["union", "union status", "contract"] },
  { key: "platform", label: "Platform", aliases: ["platform", "network", "studio", "streamer", "distributor"] },
  { key: "productionType", label: "Production Type", aliases: ["production type", "type", "project type", "format"] },
  { key: "visibility", label: "Visibility", aliases: ["visibility", "status", "casting status"] },
  { key: "source", label: "Source", aliases: ["source", "source name", "site", "found on"] },
  { key: "url", label: "URL", aliases: ["url", "link", "source url", "website"] },
];

export const AGENCY_FIELDS: FieldDef[] = [
  { key: "dateSubmitted", label: "Date Submitted", aliases: ["date submitted", "date", "submitted", "submission date", "submitted on"] },
  { key: "project", label: "Project", required: true, aliases: ["project", "project title", "title", "production", "show"] },
  { key: "role", label: "Role", aliases: ["role", "character", "part"] },
  { key: "castingDirector", label: "Casting Director", aliases: ["casting director", "cd", "casting"] },
  { key: "platform", label: "Platform", aliases: ["platform", "network", "studio", "streamer"] },
  { key: "region", label: "Region", aliases: ["region", "market", "location"] },
  { key: "union", label: "Union", aliases: ["union", "union status", "contract"] },
  { key: "status", label: "Status", aliases: ["status", "submission status", "result"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "comments", "comment"] },
];

export function fieldsFor(kind: ImportKind): FieldDef[] {
  return kind === "PUBLIC_BREAKDOWN" ? PUBLIC_FIELDS : AGENCY_FIELDS;
}

export type ColumnMapping = Record<string, string | null>; // fieldKey -> header

/** Suggest a field->header mapping from header names. */
export function suggestMapping(headers: string[], kind: ImportKind): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  const folded = headers.map((h) => ({ h, f: basicFold(h).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() }));
  for (const field of fieldsFor(kind)) {
    const hit =
      folded.find((x) => !used.has(x.h) && field.aliases.includes(x.f)) ??
      folded.find((x) => !used.has(x.h) && basicFold(field.label) === x.f);
    mapping[field.key] = hit ? hit.h : null;
    if (hit) used.add(hit.h);
  }
  return mapping;
}

export interface PublicRow {
  project: string;
  castingDirector: string | null;
  castingOffice: string | null;
  role: string | null;
  roleType: string | null;
  characterDescription: string | null;
  ageRange: string | null;
  gender: string | null;
  ethnicity: string | null;
  date: Date | null;
  deadline: Date | null;
  region: RegionCode | null;
  union: string | null;
  platform: string | null;
  productionType: string | null;
  visibility: "PUBLIC" | "UNKNOWN" | "CLOSED";
  source: string;
  url: string | null;
}

export interface AgencyRow {
  dateSubmitted: Date | null;
  project: string;
  role: string | null;
  castingDirector: string | null;
  platform: string | null;
  region: RegionCode | null;
  union: string | null;
  status: string | null;
  notes: string | null;
}

export interface RowResult<T> {
  index: number; // 1-based data row number
  valid: boolean;
  errors: string[];
  value: T | null;
  raw: Record<string, string>;
}

function pick(raw: Record<string, string>, mapping: ColumnMapping, key: string): string | null {
  const h = mapping[key];
  if (!h) return null;
  const v = raw[h];
  return v && v.trim() ? v.trim() : null;
}

function limit(v: string | null, n: number, errors: string[], label: string): string | null {
  if (v && v.length > n) {
    errors.push(`${label} is too long (max ${n} characters)`);
    return v.slice(0, n);
  }
  return v;
}

function parseVisibility(v: string | null): "PUBLIC" | "UNKNOWN" | "CLOSED" {
  if (!v) return "UNKNOWN";
  const f = basicFold(v);
  if (/closed|expired|filled|cancel/.test(f)) return "CLOSED";
  if (/public|open|active/.test(f)) return "PUBLIC";
  return "UNKNOWN";
}

export function validatePublicRow(raw: Record<string, string>, mapping: ColumnMapping, index: number, defaultSource: string): RowResult<PublicRow> {
  const errors: string[] = [];
  const project = limit(pick(raw, mapping, "project"), 300, errors, "Project");
  if (!project) errors.push("Project is required");
  const dateRaw = pick(raw, mapping, "date");
  const deadlineRaw = pick(raw, mapping, "deadline");
  const date = parseDate(dateRaw);
  const deadline = parseDate(deadlineRaw);
  if (dateRaw && !date) errors.push(`Unrecognized date “${dateRaw}”`);
  if (deadlineRaw && !deadline) errors.push(`Unrecognized deadline “${deadlineRaw}”`);
  const urlRaw = pick(raw, mapping, "url");
  const url = sanitizeUrl(urlRaw);
  if (urlRaw && !url) errors.push("URL must be http(s)");
  const value: PublicRow = {
    project: project ?? "",
    castingDirector: limit(pick(raw, mapping, "castingDirector"), 300, errors, "Casting director"),
    castingOffice: limit(pick(raw, mapping, "castingOffice"), 200, errors, "Casting office"),
    role: limit(pick(raw, mapping, "role"), 200, errors, "Role"),
    roleType: limit(pick(raw, mapping, "roleType"), 100, errors, "Role type"),
    characterDescription: limit(pick(raw, mapping, "characterDescription"), 4000, errors, "Description"),
    ageRange: limit(pick(raw, mapping, "ageRange"), 60, errors, "Age range"),
    gender: limit(pick(raw, mapping, "gender"), 60, errors, "Gender"),
    ethnicity: limit(pick(raw, mapping, "ethnicity"), 200, errors, "Ethnicity"),
    date,
    deadline,
    region: parseRegion(pick(raw, mapping, "region")),
    union: limit(pick(raw, mapping, "union"), 100, errors, "Union"),
    platform: canonicalPlatform(pick(raw, mapping, "platform")),
    productionType: limit(pick(raw, mapping, "productionType"), 100, errors, "Production type"),
    visibility: parseVisibility(pick(raw, mapping, "visibility")),
    source: limit(pick(raw, mapping, "source"), 200, errors, "Source") ?? defaultSource,
    url,
  };
  return { index, valid: errors.length === 0, errors, value: errors.length === 0 ? value : null, raw };
}

export function validateAgencyRow(raw: Record<string, string>, mapping: ColumnMapping, index: number): RowResult<AgencyRow> {
  const errors: string[] = [];
  const project = limit(pick(raw, mapping, "project"), 300, errors, "Project");
  if (!project) errors.push("Project is required");
  const dRaw = pick(raw, mapping, "dateSubmitted");
  const dateSubmitted = parseDate(dRaw);
  if (dRaw && !dateSubmitted) errors.push(`Unrecognized date “${dRaw}”`);
  const value: AgencyRow = {
    dateSubmitted,
    project: project ?? "",
    role: limit(pick(raw, mapping, "role"), 200, errors, "Role"),
    castingDirector: limit(pick(raw, mapping, "castingDirector"), 300, errors, "Casting director"),
    platform: canonicalPlatform(pick(raw, mapping, "platform")),
    region: parseRegion(pick(raw, mapping, "region")),
    union: limit(pick(raw, mapping, "union"), 100, errors, "Union"),
    status: limit(pick(raw, mapping, "status"), 100, errors, "Status"),
    notes: limit(pick(raw, mapping, "notes"), 4000, errors, "Notes"),
  };
  return { index, valid: errors.length === 0, errors, value: errors.length === 0 ? value : null, raw };
}
