import { isValidEmail, normalizePhone } from "../normalize";

export const IMPORT_FIELDS = [
  "businessName",
  "contactName",
  "jobTitle",
  "phone",
  "email",
  "address",
  "city",
  "state",
  "zip",
  "industry",
  "externalId",
  "employeeCount",
  "repName",
  "appointmentDate",
  "appointmentTime",
  "appointmentStatus",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportValues = Partial<Record<ImportField, string | null>>;
export type ImportConfidence = Partial<Record<ImportField, "high" | "medium" | "low" | null>>;

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  businessName: "Business name",
  contactName: "Contact",
  jobTitle: "Title",
  phone: "Phone",
  email: "Email",
  address: "Address",
  city: "City",
  state: "State",
  zip: "ZIP",
  industry: "Industry",
  externalId: "Prospect / account #",
  employeeCount: "Employees",
  repName: "Sales rep (from file)",
  appointmentDate: "Appointment date",
  appointmentTime: "Appointment time",
  appointmentStatus: "Appointment status",
  notes: "Notes",
};

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
  externalId: ["pn", "prospect", "prospect #", "prospect number", "prospect id", "account #", "account number", "account id", "customer #", "customer id", "lead id", "id"],
  employeeCount: ["employees", "employee count", "employeecount", "# employees", "number of employees", "headcount", "staff"],
  repName: ["rep", "sales rep", "salesperson", "sales person", "assigned to", "assigned rep", "consultant"],
  appointmentDate: ["appt date", "apptdate", "appointment date", "appointment", "visit date", "meeting date"],
  appointmentTime: ["appt time", "appttime", "appointment time", "time", "visit time", "meeting time"],
  appointmentStatus: ["appt status", "appointment status", "confirmed", "confirmation"],
  notes: ["notes", "note", "comments", "comment", "description", "details", "sitcomments", "sit comments"],
};

/**
 * Known export layouts whose column names don't describe themselves. A preset only says which column
 * holds what; every other column is still kept with the lead word for word.
 */
const PRESETS: { name: string; matches: (headers: Set<string>) => boolean; mapping: Record<string, ImportField> }[] = [
  {
    name: "Appointment log export",
    matches: (h) => ["APPTDATE", "PN", "COMPANY", "PHONE"].every((x) => h.has(x)),
    mapping: {
      APPTDATE: "appointmentDate",
      APPTTIME: "appointmentTime",
      PN: "externalId",
      COMPANY: "businessName",
      ADDRESS: "address",
      CITY: "city",
      ST: "state",
      ZIP: "zip",
      PHONE: "phone",
      Name: "contactName",
      EmployeeCount: "employeeCount",
      SitComments: "notes",
      Combo23: "repName",
      Text129: "appointmentStatus",
    },
  },
];

const norm = (h: string) => h.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

/** Map CSV headers to lead fields: a known layout first, otherwise by exact synonym match. Unrecognized columns stay unmapped (never guessed). */
export function autoMapHeaders(headers: string[]): Record<string, ImportField | ""> {
  const set = new Set(headers);
  const preset = PRESETS.find((p) => p.matches(set));
  if (preset) return Object.fromEntries(headers.map((h) => [h, preset.mapping[h] ?? ""]));
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

export function detectPreset(headers: string[]): string | null {
  const set = new Set(headers);
  return PRESETS.find((p) => p.matches(set))?.name ?? null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
function validDate(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 1990 && y <= 2100 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** "27-Feb-26", "2/27/2026", "2026-02-27", "Feb 27, 2026" → "2026-02-27"; anything else → null. */
export function parseLooseDate(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  let m = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{2}|\d{4})$/);
  if (m) return MONTHS.indexOf(m[2].toLowerCase()) >= 0 ? validDate(year(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1])) : null;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) return validDate(year(m[3]), Number(m[1]), Number(m[2]));
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS.indexOf(m[1].toLowerCase()) >= 0) return validDate(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2]));
  return null;
}

/** "9:30 AM", "14:05", "2:00pm", "10:00:00" → "HH:mm"; a value with no time of day (e.g. a date) → null. */
export function parseLooseTime(s: string | null | undefined): string | null {
  const m = (s ?? "").trim().match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  }
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : null;
}

/** Appointment status words from other systems → this app's statuses. Unknown words → null (reviewer decides). */
export function parseApptStatus(s: string | null | undefined): "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "CANCELED" | "NO_SHOW" | null {
  const t = (s ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return "SCHEDULED";
  if (["confirmed", "confirm", "yes", "y", "true"].includes(t)) return "CONFIRMED";
  if (["scheduled", "set", "booked", "pending", "open"].includes(t)) return "SCHEDULED";
  if (["completed", "complete", "kept", "done", "held", "sat"].includes(t)) return "COMPLETED";
  if (["canceled", "cancelled", "cancel", "cxl"].includes(t)) return "CANCELED";
  if (["noshow", "ns", "missed"].includes(t)) return "NO_SHOW";
  return null;
}

/** "Mozzano, Louis" → "louis mozzano"; "Louis Mozzano" → "louis mozzano". */
export function normalizePersonName(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  const flipped = /^[^,]+,\s*[^,]+$/.test(t) ? t.split(",").reverse().map((x) => x.trim()).join(" ") : t;
  return flipped.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Apply a header mapping to one CSV row. Values are copied as written; the only reformatting is
 * a 9-digit ZIP shown as ZIP+4 (same digits). Multiple columns mapped to notes are joined verbatim.
 */
export function applyMapping(row: Record<string, string>, mapping: Record<string, ImportField | "">): ImportValues {
  const v: ImportValues = {};
  for (const [h, f] of Object.entries(mapping)) {
    if (!f) continue;
    const cell = (row[h] ?? "").trim();
    if (!cell) continue;
    if (f === "notes" && v.notes) v.notes = `${v.notes}\n${cell}`;
    else if (!v[f]) v[f] = cell;
  }
  if (v.zip && /^\d{9}$/.test(v.zip)) v.zip = `${v.zip.slice(0, 5)}-${v.zip.slice(5)}`;
  if (v.appointmentTime && !parseLooseTime(v.appointmentTime)) delete v.appointmentTime; // e.g. a placeholder date in a time column
  return v;
}

/** Columns that aren't mapped to a field, with their non-empty values exactly as in the file. */
export function unmappedDetails(row: Record<string, string>, mapping: Record<string, ImportField | "">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [h, val] of Object.entries(row)) {
    if (mapping[h]) continue;
    const t = (val ?? "").trim();
    if (t) out[h] = t;
  }
  return out;
}

const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));

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
  if (values.state && /^[A-Za-z]{2}$/.test(values.state) && !US_STATES.has(values.state.toUpperCase())) flags.push({ field: "state", level: "warn", message: `“${values.state}” isn't a US state code — check it` });
  if (values.employeeCount && !/^\d{1,7}$/.test(values.employeeCount.replace(/[,\s]/g, ""))) flags.push({ field: "employeeCount", level: "error", message: "Employees should be a whole number" });
  if (values.appointmentDate && !parseLooseDate(values.appointmentDate)) flags.push({ field: "appointmentDate", level: "error", message: "Appointment date not understood — use a date like 06-May-26 or 5/6/2026, or clear it" });
  if (values.appointmentTime && !parseLooseTime(values.appointmentTime)) flags.push({ field: "appointmentTime", level: "error", message: "Appointment time not understood — use a time like 10:30 AM, or clear it" });
  if (values.appointmentStatus && !parseApptStatus(values.appointmentStatus)) flags.push({ field: "appointmentStatus", level: "warn", message: `Status “${values.appointmentStatus}” isn't recognized — the appointment will be imported as Scheduled` });
  if (values.appointmentDate && !values.appointmentTime && parseLooseDate(values.appointmentDate)) flags.push({ field: "appointmentDate", level: "info", message: "No time in the file — the appointment is added for that date with the time not set" });
  for (const f of IMPORT_FIELDS) {
    const c = confidence?.[f];
    if (values[f] && (c === "low" || c === "medium")) flags.push({ field: f, level: c === "low" ? "warn" : "info", message: `${c === "low" ? "Low" : "Medium"} confidence reading — check against the image` });
  }
  return flags;
}

export const hasBlockingFlag = (flags: ReviewFlag[]) => flags.some((f) => f.level === "error");
/** "Clean" rows can be imported in bulk: no errors, no low-confidence values, no warnings that need a decision. */
export const isClean = (flags: ReviewFlag[]) => !flags.some((f) => f.level === "error" || (f.level === "warn" && (f.message.startsWith("Low") || f.message.includes("isn't a US state") || f.message.startsWith("Status") || f.message.includes("looks like a misspelling"))));

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1); // swapped letters
    }
  return dp[a.length][b.length];
}

const cityKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * A city that is probably a misspelling of a more common city (in the same file, or an existing area):
 * e.g. "Bolwing Green" → "Bowling Green". Only suggests — the reviewer decides; nothing is changed automatically.
 */
export function likelyCityTypo(city: string | null | undefined, counts: Map<string, { name: string; count: number }>): string | null {
  if (!city?.trim()) return null;
  const key = cityKey(city);
  const mine = counts.get(key)?.count ?? 0;
  let best: { name: string; count: number } | null = null;
  for (const [k, c] of counts) {
    if (k === key || c.count <= mine) continue;
    const max = Math.min(key.length, k.length) >= 8 ? 2 : Math.min(key.length, k.length) >= 5 ? 1 : 0;
    if (max && editDistance(key, k) <= max && (!best || c.count > best.count)) best = c;
  }
  return best?.name ?? null;
}
export { cityKey };
