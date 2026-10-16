import { isValidEmail, normalizePhone } from "../normalize";

export const IMPORT_FIELDS = ["businessName", "contactName", "jobTitle", "phone", "email", "address", "city", "state", "zip", "industry", "notes"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportValues = Partial<Record<ImportField, string | null>>;
export type ImportConfidence = Partial<Record<ImportField, "high" | "medium" | "low" | null>>;

const SYNONYMS: Record<ImportField, string[]> = {
  businessName: ["business", "business name", "company", "company name", "name", "account", "account name", "store", "organization", "title of business"],
  contactName: ["contact", "contact name", "owner", "manager", "person", "first and last name", "full name", "decision maker"],
  jobTitle: ["title", "job title", "position", "role"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "cell", "business phone"],
  email: ["email", "e-mail", "email address"],
  address: ["address", "street", "street address", "address 1", "address line 1", "location"],
  city: ["city", "town"],
  state: ["state", "province", "st"],
  zip: ["zip", "zip code", "zipcode", "postal", "postal code"],
  industry: ["industry", "category", "type", "business type", "vertical"],
  notes: ["notes", "note", "comments", "comment", "description", "details"],
};

const norm = (h: string) => h.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

/** Map CSV headers to lead fields by exact synonym match. Unrecognized columns are left unmapped (never guessed). */
export function autoMapHeaders(headers: string[]): Record<string, ImportField | ""> {
  const used = new Set<ImportField>();
  const out: Record<string, ImportField | ""> = {};
  for (const h of headers) {
    const n = norm(h);
    const f = IMPORT_FIELDS.find((k) => !used.has(k) && (n === norm(k) || SYNONYMS[k].some((x) => norm(x) === n)));
    out[h] = f ?? "";
    if (f) used.add(f);
  }
  return out;
}

/** Apply a header mapping to one CSV row. Multiple columns mapped to notes are joined verbatim. */
export function applyMapping(row: Record<string, string>, mapping: Record<string, ImportField | "">): ImportValues {
  const v: ImportValues = {};
  for (const [h, f] of Object.entries(mapping)) {
    if (!f) continue;
    const cell = (row[h] ?? "").trim();
    if (!cell) continue;
    if (f === "notes" && v.notes) v.notes = `${v.notes}\n${cell}`;
    else if (!v[f]) v[f] = cell;
  }
  return v;
}

export interface ReviewFlag {
  field?: ImportField;
  level: "error" | "warn" | "info";
  message: string;
}

/** Issues a reviewer must see before importing a row. Missing values are flagged, never filled in. */
export function reviewFlags(values: ImportValues, confidence: ImportConfidence | null | undefined): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  if (!values.businessName) flags.push({ field: "businessName", level: "error", message: "Business name is missing — required to import" });
  if (!values.phone && !values.email) flags.push({ field: "phone", level: "warn", message: "No phone or email in the source — left blank" });
  if (!values.address) flags.push({ field: "address", level: "warn", message: "No address in the source — left blank" });
  if (values.phone && normalizePhone(values.phone).length < 7) flags.push({ field: "phone", level: "error", message: "Phone number looks incomplete" });
  if (values.email && !isValidEmail(values.email)) flags.push({ field: "email", level: "error", message: "Email address isn't valid" });
  if (values.zip && !/^\d{5}(-\d{4})?$/.test(values.zip)) flags.push({ field: "zip", level: "error", message: "ZIP should be 5 digits (or ZIP+4)" });
  for (const f of IMPORT_FIELDS) {
    const c = confidence?.[f];
    if (values[f] && (c === "low" || c === "medium")) flags.push({ field: f, level: c === "low" ? "warn" : "info", message: `${c === "low" ? "Low" : "Medium"} confidence reading — check against the image` });
  }
  return flags;
}

export const hasBlockingFlag = (flags: ReviewFlag[]) => flags.some((f) => f.level === "error");
/** "Clean" rows can be imported in bulk: no errors and no low-confidence values. */
export const isClean = (flags: ReviewFlag[]) => !flags.some((f) => f.level === "error" || (f.level === "warn" && f.message.startsWith("Low")));
