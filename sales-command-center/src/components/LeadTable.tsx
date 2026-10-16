"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, SubmitButton } from "./ActionForm";
import { bulkLeadAction } from "@/app/actions/leads";

export interface LeadRow {
  id: string;
  leadNumber: number;
  businessName: string;
  contactName: string | null;
  areaName: string | null;
  territoryColor: string | null;
  repName: string | null;
  statusBadge: React.ReactNode;
  priorityBadge: React.ReactNode;
  lastVisited: string;
  lastFeedback: string | null;
  nextFollowUp: React.ReactNode;
  nextAppointment: string;
  archived: boolean;
  demo: boolean;
}

export function LeadTable({ rows, canBulk, reps, areas, statuses, priorities }: {
  rows: LeadRow[];
  canBulk: boolean;
  reps: { id: string; name: string }[];
  areas: { id: string; label: string }[];
  statuses: { value: string; label: string }[];
  priorities: { value: string; label: string }[];
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState("assign");
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      {canBulk && sel.size > 0 && (
        <ActionForm action={bulkLeadAction} className="sticky top-14 z-20 mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-accent/30 bg-accent-2 p-3 lg:top-2" confirm={kind === "archive" ? `Archive ${sel.size} lead(s)? Their history is kept and you can restore them.` : undefined}>
          {[...sel].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
          <span className="self-center text-sm font-medium">{sel.size} selected</span>
          <label className="block">
            <span className="label">Bulk action</span>
            <select name="bulk" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="assign">Assign to rep</option>
              <option value="status">Set status</option>
              <option value="priority">Set priority</option>
              <option value="area">Move to area</option>
              <option value="tag">Add tag</option>
              <option value="archive">Archive</option>
              <option value="restore">Restore</option>
            </select>
          </label>
          {kind === "assign" && (
            <label className="block"><span className="label">Rep</span>
              <select name="repId" className="input"><option value="">Unassigned</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            </label>
          )}
          {kind === "status" && (
            <label className="block"><span className="label">Status</span>
              <select name="status" className="input">{statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
            </label>
          )}
          {kind === "priority" && (
            <label className="block"><span className="label">Priority</span>
              <select name="priority" className="input">{priorities.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
            </label>
          )}
          {kind === "area" && (
            <label className="block"><span className="label">Area</span>
              <select name="areaId" className="input"><option value="">No area</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
            </label>
          )}
          {kind === "tag" && <label className="block"><span className="label">Tag</span><input name="tag" className="input" required /></label>}
          <SubmitButton>Apply</SubmitButton>
          <button type="button" className="btn-ghost" onClick={() => setSel(new Set())}>Clear</button>
        </ActionForm>
      )}

      {/* desktop table */}
      <div className="card hidden overflow-x-auto md:block">
        <table className="tbl">
          <thead>
            <tr>
              {canBulk && (
                <th className="w-8"><input type="checkbox" aria-label="Select all on this page" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              )}
              <th>Business</th>
              <th>Area</th>
              <th>Status</th>
              <th>Last visited</th>
              <th>Last feedback</th>
              <th>Next follow-up</th>
              <th>Next appointment</th>
              {canBulk && <th>Rep</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.archived ? "opacity-60" : ""}>
                {canBulk && <td><input type="checkbox" aria-label={`Select ${r.businessName}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>}
                <td className="min-w-[200px]">
                  <Link href={`/leads/${r.id}`} className="font-medium hover:underline">{r.businessName}</Link>
                  <div className="text-xs text-muted">#{r.leadNumber}{r.contactName ? ` · ${r.contactName}` : ""} {r.priorityBadge} {r.demo && <span className="text-amber-700">· demo</span>}</div>
                </td>
                <td className="whitespace-nowrap">
                  {r.areaName ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: r.territoryColor ?? "#9ca3af" }} />{r.areaName}</span> : <span className="text-muted">—</span>}
                </td>
                <td>{r.statusBadge}</td>
                <td className="whitespace-nowrap">{r.lastVisited}</td>
                <td className="max-w-[240px]"><span className="line-clamp-2 text-ink-2">{r.lastFeedback ?? <span className="text-muted">—</span>}</span></td>
                <td className="whitespace-nowrap">{r.nextFollowUp}</td>
                <td className="whitespace-nowrap">{r.nextAppointment}</td>
                {canBulk && <td className="whitespace-nowrap text-ink-2">{r.repName ?? <span className="text-muted">Unassigned</span>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* phone cards */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="card p-3">
            <div className="flex items-start gap-2">
              {canBulk && <input type="checkbox" className="mt-1" aria-label={`Select ${r.businessName}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />}
              <div className="min-w-0 flex-1">
                <Link href={`/leads/${r.id}`} className="font-medium">{r.businessName}</Link>
                <div className="text-xs text-muted">{r.areaName ?? "No area"} · last visited {r.lastVisited}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">{r.statusBadge}{r.priorityBadge}{r.nextFollowUp}</div>
                {r.lastFeedback && <p className="mt-1 line-clamp-2 text-xs text-ink-2">{r.lastFeedback}</p>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
