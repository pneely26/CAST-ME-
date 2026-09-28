"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { parseUpload, ImportError, MAX_ROWS, type FileKind } from "@/lib/import/parse";
import { suggestMapping, fieldsFor, type ColumnMapping, type ImportKind } from "@/lib/import/mapping";
import { commitAgencyImport, commitPublicImport, previewAgencyImport, previewPublicImport, type PreviewResult } from "@/lib/server/imports";

export interface ParsedUpload {
  ok: true;
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  mapping: ColumnMapping;
}

type Err = { ok: false; error: string };

function kindOf(v: unknown): ImportKind {
  if (v === "PUBLIC_BREAKDOWN" || v === "AGENCY_SUBMISSION") return v;
  throw new ImportError("Invalid import type");
}

function cleanFileName(name: string) {
  return name.replace(/[^\w.\- ()]/g, "_").slice(0, 120);
}

export async function parseUploadAction(fd: FormData): Promise<ParsedUpload | Err> {
  await requireUser();
  try {
    const kind = kindOf(fd.get("kind"));
    const file = fd.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Choose a file to upload." };
    const allowed: FileKind[] = kind === "PUBLIC_BREAKDOWN" ? ["csv", "xlsx", "json"] : ["csv", "xlsx"];
    const buf = await file.arrayBuffer();
    const t = await parseUpload(file.name, buf, allowed);
    if (t.rows.length === 0) return { ok: false, error: "No data rows found in the file." };
    return { ok: true, fileName: cleanFileName(file.name), headers: t.headers, rows: t.rows, mapping: suggestMapping(t.headers, kind) };
  } catch (e) {
    return { ok: false, error: e instanceof ImportError ? e.message : "Could not read that file." };
  }
}

/** Re-validate client-provided payloads: rows must be flat string maps, mapping must reference known fields/headers. */
function sanitizePayload(kind: ImportKind, rows: unknown, mapping: unknown) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new ImportError("Invalid rows.");
  const clean = rows.map((r) => {
    if (!r || typeof r !== "object") throw new ImportError("Invalid row.");
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(r as Record<string, unknown>).slice(0, 100)) o[String(k).slice(0, 200)] = String(v ?? "").slice(0, 5000);
    return o;
  });
  const keys = new Set(fieldsFor(kind).map((f) => f.key));
  const m: ColumnMapping = {};
  for (const [k, v] of Object.entries((mapping ?? {}) as Record<string, unknown>)) {
    if (keys.has(k)) m[k] = typeof v === "string" && v ? v.slice(0, 200) : null;
  }
  if (!m.project) throw new ImportError("Map a column to “Project” before continuing.");
  return { rows: clean, mapping: m };
}

export async function previewImportAction(kindRaw: string, rowsRaw: unknown, mappingRaw: unknown, defaultSource: string): Promise<{ ok: true; preview: PreviewResult } | Err> {
  await requireUser();
  try {
    const kind = kindOf(kindRaw);
    const { rows, mapping } = sanitizePayload(kind, rowsRaw, mappingRaw);
    const preview =
      kind === "PUBLIC_BREAKDOWN"
        ? await previewPublicImport({ rows, mapping, defaultSource: String(defaultSource || "Manual import").slice(0, 200) })
        : await previewAgencyImport({ rows, mapping });
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: e instanceof ImportError ? e.message : "Preview failed." };
  }
}

export async function commitImportAction(
  kindRaw: string,
  fileName: string,
  rowsRaw: unknown,
  mappingRaw: unknown,
  defaultSource: string,
  decisionsRaw: Record<string, string>,
  confirmOverwrite: boolean,
  markVerified: boolean,
): Promise<{ ok: true; saved: number; skipped: number; errors: string[] } | Err> {
  await requireUser();
  try {
    const kind = kindOf(kindRaw);
    const { rows, mapping } = sanitizePayload(kind, rowsRaw, mappingRaw);
    const decisions: Record<number, string> = {};
    for (const [k, v] of Object.entries(decisionsRaw ?? {})) {
      const n = Number(k);
      if (Number.isInteger(n) && typeof v === "string" && /^(new|skip|import|attach:[a-z0-9]+|update:[a-z0-9]+)$/i.test(v)) decisions[n] = v;
    }
    const name = cleanFileName(fileName || "upload");
    let result: { saved: number; skipped: number; errors?: string[] };
    if (kind === "PUBLIC_BREAKDOWN") {
      result = await commitPublicImport({ rows, mapping, defaultSource: String(defaultSource || "Manual import").slice(0, 200), fileName: name }, decisions, Boolean(confirmOverwrite), Boolean(markVerified));
    } else {
      result = await commitAgencyImport({ rows, mapping, fileName: name }, decisions);
    }
    revalidatePath("/", "layout");
    return { ok: true, saved: result.saved, skipped: result.skipped, errors: result.errors ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof ImportError ? e.message : `Import failed: ${(e as Error).message}` };
  }
}
