/**
 * Turn pasted casting text (a breakdown you can see, a casting email, an agent's email)
 * into structured fields. Only information that is written in the text is extracted.
 * Ethnicity is only captured when it is stated with a recognized term or label.
 */
import { canonicalPlatform, parseRegion, type RegionCode } from "../constants";
import { parseDate } from "../import/parse";
import { detectPlatform, detectRegions } from "../web/extract";

export interface ParsedRole {
  roleName: string;
  roleType: string | null;
  ageRange: string | null;
  gender: string | null;
  ethnicity: string | null;
  description: string;
}

export interface ParsedListing {
  project: string | null;
  productionType: string | null;
  platform: string | null;
  union: string | null;
  castingDirector: string | null;
  castingOffice: string | null;
  location: string | null;
  region: RegionCode | null;
  deadline: string | null; // yyyy-mm-dd
  postedDate: string | null; // yyyy-mm-dd
  roles: ParsedRole[];
  notes: string[];
  /** where the project title came from (a guess from the first line is the weakest) */
  projectFrom?: "label" | "quote" | "subject" | "firstLine" | null;
}

const LABELS: Record<keyof Omit<ParsedListing, "roles" | "notes" | "region" | "projectFrom"> | "region" | "role" | "rate" | "age" | "gender" | "ethnicity" | "roleType" | "status", string[]> = {
  project: ["project", "project title", "title", "production", "production title", "show", "series", "film", "project name"],
  productionType: ["type", "project type", "production type", "format", "category", "media"],
  platform: ["network", "platform", "studio", "network/studio", "studio/network", "distributor", "streamer", "network / studio", "for"],
  castingDirector: ["casting director", "casting directors", "casting", "cd", "casting by", "casting director(s)"],
  castingOffice: ["casting office", "casting company", "office"],
  union: ["union", "union status", "contract", "union/contract", "unions", "agreement"],
  deadline: ["submission deadline", "submissions due", "submissions due by", "deadline", "due", "due date", "submit by", "respond by", "submission due", "submissions close", "apply by"],
  postedDate: ["posted", "date posted", "released", "release date", "date", "breakdown date"],
  location: ["location", "shoot location", "filming location", "shoots in", "work location", "audition location", "location of production", "shooting location", "city", "production location"],
  region: ["region", "market", "casting region", "area"],
  role: ["role", "character", "role name", "part"],
  roleType: ["role type", "billing", "role size", "size"],
  rate: ["rate", "pay", "compensation", "rates"],
  age: ["age", "ages", "age range", "playing age"],
  gender: ["gender", "sex"],
  ethnicity: ["ethnicity", "ethnicities", "race"],
  status: ["status", "submission status"],
};

const LABEL_INDEX = new Map<string, string>();
for (const [k, list] of Object.entries(LABELS)) for (const l of list) LABEL_INDEX.set(l, k);

const ROLE_TYPES = [
  "series regular", "recurring", "guest star", "co-star", "costar", "lead", "supporting", "day player",
  "featured", "principal", "ensemble", "under five", "under-5", "background", "swing", "understudy", "voice over",
];

const ETHNICITY_TERMS = [
  "all ethnicities", "any ethnicity", "open ethnicity", "ethnicity open", "all races", "ethnically ambiguous",
  "african american", "black", "white", "caucasian", "latina", "latino", "latinx", "latine", "hispanic",
  "east asian", "south asian", "southeast asian", "asian", "middle eastern", "north african", "mena",
  "native american", "indigenous", "pacific islander", "native hawaiian", "multiracial", "mixed race", "biracial",
];

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";

/** Dates like "Oct 20", "October 20th, 2026", "10/20", "10/20/26", "2026-10-20". Missing year -> next occurrence. */
export function parseLooseDate(input: string | null | undefined, now = new Date()): Date | null {
  if (!input) return null;
  let s = input.trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s*/i, "");
  const m = s.match(new RegExp(`\\b(${MONTHS})\\.? (\\d{1,2})(?:,? (\\d{4}))?`, "i")) ?? s.match(/\b(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\b/) ?? s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (!m) return null;
  s = m[0];
  let d: Date | null;
  if (/^\d{1,2}[/.-]\d{1,2}$/.test(s)) d = parseDate(`${s}/${now.getUTCFullYear()}`);
  else if (new RegExp(`^(${MONTHS})`, "i").test(s) && !/\d{4}/.test(s)) d = parseDate(`${s} ${now.getUTCFullYear()}`);
  else d = parseDate(s);
  if (!d) return null;
  // no explicit year and the date is well in the past -> assume next year
  if (!/\d{4}/.test(s) && !/\d{1,2}[/.-]\d{1,2}[/.-]\d{2}/.test(s) && d.getTime() < now.getTime() - 60 * 86_400_000) {
    d = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate(), 12));
  }
  return d;
}

/** "…Deadline: 10/30…" or "submit by Oct 30" inside a sentence. Only labelled dates count. */
function inlineDeadline(text: string): string | null {
  const m = text.match(/\b(?:deadline|submit(?:ted)? by|submissions? (?:are )?due(?: by)?|due by|respond by|apply by|submissions? close[sd]?)\b\s*[:\-–]?\s*([^\n.;]{2,40})/i);
  return m ? m[1] : null;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLabel(line: string): { key: string; value: string } | null {
  const m = line.match(/^\s*[*•-]?\s*([A-Za-z][A-Za-z /()&.-]{0,40}?)\s*[:|]\s*(.*)$/);
  if (!m) return null;
  const key = LABEL_INDEX.get(m[1].trim().toLowerCase().replace(/\s+/g, " "));
  return key ? { key, value: m[2].trim() } : null;
}

export function findGender(s: string): string | null {
  const m = s.match(/\b(non[- ]?binary|gender[- ]?(?:fluid|non[- ]?conforming|open)|all genders|any gender|female|male|women|woman|men|man|girl|boy|transgender (?:woman|man|female|male))\b/i);
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (/^(woman|women|girl)$/.test(v)) return "Female";
  if (/^(man|men|boy)$/.test(v)) return "Male";
  return v.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function findAge(s: string): string | null {
  const m =
    s.match(/\b(?:ages?\s*[:-]?\s*)?((?:early|mid|late)[ -]?\d0'?s(?:\s*(?:to|-|–)\s*(?:early|mid|late)?[ -]?\d0'?s)?)\b/i) ??
    s.match(/\b(\d0'?s\s*(?:to|-|–)\s*\d0'?s|\d0'?s)\b/i) ??
    s.match(/\b(?:ages?\s*[:-]?\s*)?(\d{1,2}\s*(?:-|–|to)\s*\d{1,2})\b(?!\s*[/.]\d)/i) ??
    s.match(/\b(\d{2}\s*\+)/);
  return m ? m[1].replace(/\s+/g, " ").replace("–", "-").trim() : null;
}

export function findEthnicity(s: string): string | null {
  const lower = s.toLowerCase();
  const labelled = s.match(/\b(?:ethnicit(?:y|ies)|race)\s*[:-]\s*([^.;\n]+)/i);
  if (labelled) return labelled[1].trim().slice(0, 120);
  const hits = ETHNICITY_TERMS.filter((t) => new RegExp(`(^|[^a-z])${t}([^a-z]|$)`).test(lower));
  if (hits.length === 0) return null;
  // keep original casing from the text, in order of appearance, without overlapping duplicates
  const found: { i: number; t: string }[] = [];
  for (const t of hits) {
    const i = lower.indexOf(t);
    if (!found.some((f) => i >= f.i && i < f.i + f.t.length)) found.push({ i, t: s.substr(i, t.length) });
  }
  return found.sort((a, b) => a.i - b.i).map((f) => f.t).join(" / ");
}

export function findRoleType(s: string): string | null {
  const lower = s.toLowerCase();
  const t = ROLE_TYPES.find((r) => new RegExp(`\\b${r.replace(/[-]/g, "[- ]?")}\\b`).test(lower));
  if (!t) return null;
  if (t === "costar") return "Co-Star";
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function findUnion(s: string): string | null {
  const parts: string[] = [];
  if (/\bsag[- ]?aftra\b|\bsag\b/i.test(s)) parts.push("SAG-AFTRA");
  if (/\baea\b|actors'? equity|\bequity\b/i.test(s)) parts.push("AEA");
  if (/\bnon[- ]?union\b/i.test(s)) parts.push("Non-Union");
  return parts.length ? parts.join(" / ") : null;
}

function findProductionType(s: string): string | null {
  const l = s.toLowerCase();
  if (/limited series|mini[- ]?series/.test(l)) return "Limited Series";
  if (/\bpilot\b/.test(l)) return "Pilot";
  if (/episodic|tv series|television series|\bseries\b|streaming series/.test(l)) return "TV Series";
  if (/feature film|\bfeature\b|\bmovie\b/.test(l)) return "Feature Film";
  if (/short film|\bshort\b/.test(l)) return "Short Film";
  if (/\bmusical\b/.test(l)) return "Musical";
  if (/theat(re|er)|\bplay\b|stage/.test(l)) return "Theatre";
  if (/commercial|\bspot\b|\bad campaign\b/.test(l)) return "Commercial";
  if (/new media|web series|digital series/.test(l)) return "New Media";
  return null;
}

/** Recognize a line that starts a role. Returns the role name and the rest of the line. */
function roleStart(line: string): { name: string; rest: string } | null {
  let m = line.match(/^\s*\[([^\]]{1,80})\]\s*[-–—:,]?\s*(.*)$/);
  if (m) return { name: m[1].trim(), rest: m[2] };
  m = line.match(/^\s*(?:role|character)\s*(?:name)?\s*[:-]\s*([^,(\n]{1,80})(.*)$/i);
  if (m) return { name: m[1].trim(), rest: m[2].replace(/^\s*[,(-]\s*/, "") };
  // ALL-CAPS NAME followed by gender/age details:  "DENISE PORTER (Female, 28-35) ..."  /  "KIRA - female, 25-32"
  m = line.match(/^\s*([A-Z][A-Z0-9 .'"&\-]{1,50}?)\s*[(\-–—:,]\s*(.*)$/);
  if (m && /[A-Z]{2}/.test(m[1]) && m[1] === m[1].toUpperCase() && (findGender(m[2]) || findAge(m[2]))) {
    return { name: m[1].trim().replace(/^"|"$/g, ""), rest: m[2] };
  }
  return null;
}

function titleCase(s: string) {
  return s === s.toUpperCase() && s.length > 3 ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s;
}

export function parseListingText(input: string, opts: { subject?: string | null; now?: Date } = {}): ParsedListing {
  const now = opts.now ?? new Date();
  const text = cleanText(input).slice(0, 50_000);
  const lines = text.split("\n");
  const fields: Record<string, string> = {};
  const notes: string[] = [];
  const roles: ParsedRole[] = [];
  let current: { name: string; lines: string[]; labels: Record<string, string> } | null = null;

  const flush = () => {
    if (!current) return;
    const block = current.lines.join(" ").replace(/\s+/g, " ").trim();
    const L = current.labels;
    roles.push({
      roleName: titleCase(current.name.replace(/^"|"$/g, "")),
      roleType: L.roleType ?? findRoleType(block),
      ageRange: L.age ?? findAge(block),
      gender: L.gender ? findGender(L.gender) ?? L.gender : findGender(block),
      ethnicity: L.ethnicity ?? findEthnicity(block),
      description: block.slice(0, 4000),
    });
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const start = roleStart(line);
    const lab = splitLabel(line);
    if (start && !(lab && lab.key !== "role")) {
      flush();
      current = { name: start.name, lines: start.rest ? [start.rest] : [], labels: {} };
      continue;
    }
    if (current) {
      if (lab && ["age", "gender", "ethnicity", "roleType"].includes(lab.key)) {
        current.labels[lab.key] = lab.value;
        current.lines.push(line);
        continue;
      }
      if (lab && !["role"].includes(lab.key) && !(lab.key in fields)) {
        // a header field after roles (e.g. deadline at the bottom)
        fields[lab.key] = lab.value;
        continue;
      }
      current.lines.push(line);
      continue;
    }
    if (lab) {
      if (lab.key === "role") {
        current = { name: lab.value.split(/[,(]/)[0].trim() || "Role", lines: [lab.value], labels: {} };
        continue;
      }
      if (!(lab.key in fields) && lab.value) fields[lab.key] = lab.value;
      continue;
    }
    notes.push(line);
  }
  flush();

  // Project: labelled, quoted title, subject line, or the first short line.
  let project: string | null = fields.project ?? null;
  let projectFrom: ParsedListing["projectFrom"] = project ? "label" : null;
  if (!project) {
    const quoted = text.match(/"([^"\n]{2,100})"/);
    if (quoted) {
      project = quoted[1];
      projectFrom = "quote";
    }
  }
  if (!project && opts.subject) {
    projectFrom = "subject";
    const s = opts.subject
      .replace(/^(re|fwd?|fw)\s*:\s*/gi, "")
      .replace(/^(casting (call|notice)|now casting|new breakdown|breakdown|submission|submitted|audition)\s*[:\-–]\s*/i, "")
      .trim();
    const m = s.match(/"([^"]+)"/);
    project = (m ? m[1] : s.split(/\s[-–|]\s/)[0]).trim() || null;
  }
  if (!project) {
    const first = notes.find(
      (n) => n.length >= 2 && n.length <= 80 && n.split(/\s+/).length <= 8 && !/[.!?,]$/.test(n) && !/[.!?]\s/.test(n) && !GREETING.test(n) && !SENTENCE_START.test(n),
    );
    if (first) {
      project = first.replace(/^"|"$/g, "");
      projectFrom = "firstLine";
    }
  }
  if (project) project = titleCase(project.replace(/\s+/g, " ").trim()).slice(0, 300);

  const header = [fields.productionType, fields.platform, fields.union, ...notes, opts.subject ?? ""].join(" \n");
  const location = fields.location ?? null;
  let region: RegionCode | null = fields.region ? parseRegion(fields.region) : null;
  if (!region && location) {
    const r = detectRegions(location);
    region = r[0] ?? parseRegion(location);
  }
  if (!region) region = detectRegions(`${header}\n${text}`)[0] ?? null;

  const platform = fields.platform ? canonicalPlatform(fields.platform.split(/[/,]/)[0]) : detectPlatform(`${header} ${opts.subject ?? ""}`);

  return {
    project,
    productionType: fields.productionType ? findProductionType(fields.productionType) ?? fields.productionType : findProductionType(header),
    platform,
    union: fields.union ? findUnion(fields.union) ?? fields.union : findUnion(header + " " + text),
    castingDirector: fields.castingDirector?.replace(/\s*,?\s*\bC\.?S\.?A\.?\b/g, "").trim() || null,
    castingOffice: fields.castingOffice ?? null,
    location,
    region,
    deadline: iso(parseLooseDate(fields.deadline ?? inlineDeadline(text), now)),
    postedDate: iso(parseLooseDate(fields.postedDate, now)),
    roles,
    notes: notes.slice(0, 30),
    projectFrom: project ? projectFrom : null,
  };
}

const SENTENCE_START = /^(seeking|looking|we|we're|our|now|casting|i|i'm|this|please|join|calling|attention|new)\b/i;
const GREETING = /^(hi|hello|hey|dear|good (morning|afternoon|evening)|greetings|thanks|thank you|best|cheers)\b/i;

export interface ParsedAgencySubmission {
  project: string | null;
  role: string | null;
  castingDirector: string | null;
  platform: string | null;
  region: RegionCode | null;
  union: string | null;
  status: string | null;
  dateSubmitted: string | null;
}

/** An email or note from the agency about a submission made for you. */
export function parseAgencyText(input: string, opts: { subject?: string | null; receivedAt?: Date | null; now?: Date } = {}): ParsedAgencySubmission {
  const l = parseListingText(input, { subject: opts.subject, now: opts.now });
  const text = cleanText(input);
  let role = l.roles[0]?.roleName ?? null;
  // a first-line guess is only used if nothing better is found below
  let project = l.projectFrom === "firstLine" ? null : l.project;
  // Subject patterns: "Submitted: Lakeshore Hours - Denise", "Submission for LAKESHORE HOURS (Denise)"
  const subj = (opts.subject ?? "").replace(/^(re|fwd?|fw)\s*:\s*/gi, "");
  const m = subj.match(/(?:submitted|submission|submitted you|submissions?)\s*(?:for|to|:)?\s*[:\-]?\s*"?([^"(\-–|]+?)"?\s*(?:[-–|(]\s*(?:role\s*:?\s*)?([^)]+)\)?)?$/i);
  if (m) {
    project = project && project !== titleCase(subj) ? project : titleCase(m[1].trim());
    if (!role && m[2]) role = titleCase(m[2].trim());
  }
  // Body sentences: "we submitted you for HARBOR LIGHTS - Nora Vance", "submitted you for the role of Nora on Harbor Lights"
  if (!project || !role) {
    const roleOf = text.match(/submitted you (?:today |this morning |yesterday )?for the role of "?([^"\n,.]+?)"? (?:on|in|for) "?([^"\n.!]+?)"?(?:[.!\n]|$)/i);
    const forProj = text.match(/submitted you (?:today |this morning |yesterday )?(?:for|to) "?([^"\n.!(]+?)"?\s*(?:[-–(:]|\bas\b)\s*(?:role\s*:?\s*)?"?([^"\n.!)]+)"?/i);
    if (roleOf) {
      role = role ?? titleCase(roleOf[1].trim());
      project = project ?? titleCase(roleOf[2].trim());
    } else if (forProj) {
      project = project ?? titleCase(forProj[1].trim());
      role = role ?? titleCase(forProj[2].trim());
    }
  }
  if (!project && l.projectFrom === "firstLine") project = l.project;
  const statusM = text.match(/\b(self[- ]?tape (?:request(?:ed)?)|callback|booked|pinned|on avail|audition (?:request(?:ed)?|scheduled)|submitted)\b/i);
  const dateLabel = text.match(/(?:date submitted|submitted on|submission date)\s*[:-]\s*([^\n]+)/i);
  return {
    project,
    role,
    castingDirector: l.castingDirector,
    platform: l.platform,
    region: l.region,
    union: l.union,
    status: statusM ? titleCase(statusM[1].replace(/\b\w/g, (c) => c.toUpperCase())) : "Submitted",
    dateSubmitted: iso(dateLabel ? parseLooseDate(dateLabel[1], opts.now) : (opts.receivedAt ?? null)),
  };
}

/** Is this email likely from the agency about a submission (vs a casting notice)? */
export function looksLikeAgencyEmail(from: string | null | undefined, subject: string | null | undefined, agentAddresses: string[]): boolean {
  const f = (from ?? "").toLowerCase();
  if (agentAddresses.some((a) => a && f.includes(a.toLowerCase().trim()))) return true;
  return /\b(submitted you|we submitted|your submission|submission (?:for|to)|submitted for)\b/i.test(subject ?? "");
}
