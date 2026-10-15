"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parsePastedAction, saveAgencyAction, saveListingAction } from "@/app/actions/paste";
import type { ParsedAgencySubmission, ParsedListing, ParsedRole } from "@/lib/listing/parse";
import { REGIONS, REGION_LABELS } from "@/lib/constants";

type Mode = "LISTING" | "AGENCY";

interface Props {
  initialText?: string;
  initialMode?: Mode;
  subject?: string | null;
  emailId?: string | null;
  platforms: string[];
  initialListing?: ParsedListing | null;
  initialAgency?: ParsedAgencySubmission | null;
  defaultSource?: string;
}

function Input({ label, value, onChange, type = "text", placeholder, className }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input" />
    </label>
  );
}

function RegionPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label">Region</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not stated</option>
        {REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
      </select>
    </label>
  );
}

function PlatformPick({ value, onChange, platforms }: { value: string; onChange: (v: string) => void; platforms: string[] }) {
  return (
    <label className="block">
      <span className="label">Platform</span>
      <input className="input" list="paste-platforms" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Netflix, HBO…" />
      <datalist id="paste-platforms">{platforms.map((p) => <option key={p} value={p} />)}</datalist>
    </label>
  );
}

const emptyRole = (): ParsedRole & { include: boolean } => ({ include: true, roleName: "", roleType: null, ageRange: null, gender: null, ethnicity: null, description: "" });

export function PasteForm(props: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode>(props.initialMode ?? "LISTING");
  const [text, setText] = useState(props.initialText ?? "");
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState<Record<string, string> | null>(props.initialListing ? listingFields(props.initialListing) : null);
  const [roles, setRoles] = useState<(ParsedRole & { include: boolean })[]>(props.initialListing ? props.initialListing.roles.map((r) => ({ ...r, include: true })) : []);
  const [agency, setAgency] = useState<Record<string, string> | null>(props.initialAgency ? agencyFields(props.initialAgency) : null);
  const [source, setSource] = useState(props.defaultSource ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [verified, setVerified] = useState(false);

  function read() {
    setError(null);
    start(async () => {
      const r = await parsePastedAction(text, mode, props.subject);
      if (!r.ok) return setError(r.error);
      if (r.listing) {
        setListing(listingFields(r.listing));
        setRoles(r.listing.roles.length ? r.listing.roles.map((x) => ({ ...x, include: true })) : [emptyRole()]);
        setAgency(null);
      }
      if (r.agency) {
        setAgency(agencyFields(r.agency));
        setListing(null);
      }
    });
  }

  function saveListing() {
    if (!listing) return;
    setError(null);
    start(async () => {
      const r = await saveListingAction({
        ...listing,
        project: listing.project,
        source,
        sourceUrl,
        verified,
        roles: roles.filter((x) => x.include).map(({ include: _i, ...rest }) => ({
          roleName: rest.roleName ?? "", roleType: rest.roleType ?? "", ageRange: rest.ageRange ?? "", gender: rest.gender ?? "", ethnicity: rest.ethnicity ?? "", description: rest.description ?? "",
        })),
        emailId: props.emailId ?? undefined,
      });
      if (!r.ok) return setError(r.error);
      router.push(`/opportunities/${r.ids[0]}?msg=${encodeURIComponent(`Saved ${r.ids.length} role(s).`)}`);
    });
  }

  function saveAgency() {
    if (!agency) return;
    setError(null);
    start(async () => {
      const r = await saveAgencyAction({ ...agency, project: agency.project, emailId: props.emailId ?? undefined });
      if (!r.ok) return setError(r.error);
      router.push(`/blind-spots/${r.blindSpotId}?msg=Submission+saved+and+checked+against+the+public+dataset`);
    });
  }

  const setL = (k: string) => (v: string) => setListing((l) => (l ? { ...l, [k]: v } : l));
  const setA = (k: string) => (v: string) => setAgency((a) => (a ? { ...a, [k]: v } : a));
  const setRole = (i: number, k: keyof ParsedRole | "include", v: string | boolean) => setRoles((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="card p-4">
        <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-line bg-paper p-1 text-sm sm:w-fit">
          {(["LISTING", "AGENCY"] as Mode[]).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setListing(null); setAgency(null); }} className={`flex-1 rounded-md px-4 py-2 ${mode === m ? "bg-ink text-white" : "text-ink-soft hover:bg-white"}`}>
              {m === "LISTING" ? "Casting listing / notice" : "Agency submission"}
            </button>
          ))}
        </div>
        {props.subject && <p className="mb-2 text-xs text-muted">Email subject: <strong>{props.subject}</strong></p>}
        <label className="label" htmlFor="paste-text">{mode === "LISTING" ? "Paste the breakdown, casting notice or email" : "Paste your agent's email or note about the submission"}</label>
        <textarea id="paste-text" value={text} onChange={(e) => setText(e.target.value)} rows={10} className="input font-mono text-xs" placeholder={mode === "LISTING" ? `"PROJECT TITLE"\nNetwork: …\nCasting Director: …\nLocation: Chicago\nSubmissions Due: Oct 22\n\n[ROLE NAME] Female, 25-35. Description…` : "Hi Paige, we submitted you for PROJECT – ROLE today…"} />
        <button type="button" className="btn-primary mt-3" onClick={read} disabled={pending || text.trim().length < 10}>{pending && !listing && !agency ? "Reading…" : "Read it"}</button>
      </div>

      {listing && (
        <div className="card space-y-4 p-4">
          <div>
            <h3 className="text-sm font-semibold">Check the details</h3>
            <p className="text-xs text-muted">Filled in from the text. Fix anything that's wrong — blank means it wasn't stated. Nothing here was guessed from descriptions.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Project *" value={listing.project} onChange={setL("project")} />
            <Input label="Production type" value={listing.productionType} onChange={setL("productionType")} />
            <PlatformPick value={listing.platform} onChange={setL("platform")} platforms={props.platforms} />
            <Input label="Casting director(s)" value={listing.castingDirector} onChange={setL("castingDirector")} />
            <Input label="Casting office" value={listing.castingOffice} onChange={setL("castingOffice")} />
            <Input label="Union" value={listing.union} onChange={setL("union")} />
            <RegionPick value={listing.region} onChange={setL("region")} />
            <Input label="Deadline" type="date" value={listing.deadline} onChange={setL("deadline")} />
            <Input label="Posted" type="date" value={listing.postedDate} onChange={setL("postedDate")} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Roles ({roles.filter((r) => r.include).length} selected)</h4>
              <button type="button" className="btn-ghost text-xs" onClick={() => setRoles((rs) => [...rs, emptyRole()])}>+ Add role</button>
            </div>
            <div className="space-y-3">
              {roles.map((r, i) => (
                <div key={i} className={`rounded-md border p-3 ${r.include ? "border-line" : "border-dashed border-line opacity-60"}`}>
                  <label className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={r.include} onChange={(e) => setRole(i, "include", e.target.checked)} /> Save this role
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <Input label="Role" value={r.roleName ?? ""} onChange={(v) => setRole(i, "roleName", v)} />
                    <Input label="Role type" value={r.roleType ?? ""} onChange={(v) => setRole(i, "roleType", v)} />
                    <Input label="Age (stated)" value={r.ageRange ?? ""} onChange={(v) => setRole(i, "ageRange", v)} />
                    <Input label="Gender (stated)" value={r.gender ?? ""} onChange={(v) => setRole(i, "gender", v)} />
                    <Input label="Ethnicity (stated)" value={r.ethnicity ?? ""} onChange={(v) => setRole(i, "ethnicity", v)} />
                  </div>
                  <label className="mt-2 block">
                    <span className="label">Description</span>
                    <textarea className="input text-sm" rows={2} value={r.description ?? ""} onChange={(e) => setRole(i, "description", e.target.value)} />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Where you saw it (source) *" value={source} onChange={setSource} placeholder="e.g. Actors Access (viewed by me), casting email" />
            <Input label="Link (optional)" type="url" value={sourceUrl} onChange={setSourceUrl} placeholder="https://…" />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> I'm looking at the original listing right now (mark as verified today)</label>
          <button type="button" className="btn-primary" onClick={saveListing} disabled={pending || !listing.project || !source}>{pending ? "Saving…" : `Save ${Math.max(1, roles.filter((r) => r.include).length)} opportunit${roles.filter((r) => r.include).length === 1 ? "y" : "ies"}`}</button>
        </div>
      )}

      {agency && (
        <div className="card space-y-4 p-4">
          <div>
            <h3 className="text-sm font-semibold">Check the submission</h3>
            <p className="text-xs text-muted">Saved privately and compared with the public dataset (blind-spot check).</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Project *" value={agency.project} onChange={setA("project")} />
            <Input label="Role" value={agency.role} onChange={setA("role")} />
            <Input label="Casting director" value={agency.castingDirector} onChange={setA("castingDirector")} />
            <PlatformPick value={agency.platform} onChange={setA("platform")} platforms={props.platforms} />
            <RegionPick value={agency.region} onChange={setA("region")} />
            <Input label="Union" value={agency.union} onChange={setA("union")} />
            <Input label="Status" value={agency.status} onChange={setA("status")} />
            <Input label="Date submitted" type="date" value={agency.dateSubmitted} onChange={setA("dateSubmitted")} />
            <Input label="Notes" value={agency.notes} onChange={setA("notes")} />
          </div>
          <button type="button" className="btn-primary" onClick={saveAgency} disabled={pending || !agency.project}>{pending ? "Saving…" : "Save & check public dataset"}</button>
        </div>
      )}
    </div>
  );
}

function listingFields(l: ParsedListing): Record<string, string> {
  return {
    project: l.project ?? "",
    productionType: l.productionType ?? "",
    platform: l.platform ?? "",
    union: l.union ?? "",
    castingDirector: l.castingDirector ?? "",
    castingOffice: l.castingOffice ?? "",
    region: l.region ?? "",
    deadline: l.deadline ?? "",
    postedDate: l.postedDate ?? "",
  };
}

function agencyFields(a: ParsedAgencySubmission): Record<string, string> {
  return {
    project: a.project ?? "",
    role: a.role ?? "",
    castingDirector: a.castingDirector ?? "",
    platform: a.platform ?? "",
    region: a.region ?? "",
    union: a.union ?? "",
    status: a.status ?? "",
    dateSubmitted: a.dateSubmitted ?? "",
    notes: "",
  };
}
