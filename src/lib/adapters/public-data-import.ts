import type { SourceAdapter, NormalizedResult } from "./types";
import { validatePublicRow, type ColumnMapping, type PublicRow } from "../import/mapping";
import { createBreakdown, findDuplicateBreakdown } from "../server/records";
import { prisma } from "../server/db";

export interface PublicImportInput {
  rows: Record<string, string>[];
  mapping: ColumnMapping;
  defaultSource: string;
}

/** decision per row index: "new" | "skip" | "attach:<projectId>" | "update:<breakdownId>" */
export interface PublicSaveOptions {
  decisions: Record<number, string>;
  confirmOverwrite: boolean;
  markVerified: boolean;
}

/**
 * PUBLIC_DATA_IMPORT — the first source adapter.
 * Data comes only from files the user exported/compiled from sources they can legitimately access.
 */
export const publicDataImportAdapter: SourceAdapter<Record<string, string>, PublicRow, PublicSaveOptions> = {
  id: "PUBLIC_DATA_IMPORT",
  name: "Public data import (CSV / XLSX / JSON)",
  description: "Imports public casting listings from a user-provided file with manual column mapping.",
  mode: "MANUAL_IMPORT",
  enabled: true,
  compliance: {
    automated: false,
    basis: "User-provided files containing publicly accessible casting information. No network access, no logins.",
  },
  async fetch(ctx) {
    const input = ctx.input as PublicImportInput;
    return input.rows;
  },
  normalize(raw, index, ctx) {
    const input = ctx.input as PublicImportInput;
    const r = validatePublicRow(raw, input.mapping, index, input.defaultSource || "Manual import");
    return { index, valid: r.valid, errors: r.errors, value: r.value };
  },
  validate(item) {
    if (!item.value) return item;
    const errors = [...item.errors];
    if (item.value.deadline && item.value.date && item.value.deadline < item.value.date) errors.push("Deadline is before the posted date");
    return { ...item, errors, valid: errors.length === 0, value: errors.length === 0 ? item.value : null };
  },
  async save(items, ctx, options) {
    const summary = { saved: 0, skipped: 0, errors: [] as string[], createdIds: [] as string[] };
    for (const item of items) {
      const v = item.value;
      const decision = options.decisions[item.index] ?? "new";
      if (!item.valid || !v || decision === "skip") {
        summary.skipped++;
        continue;
      }
      try {
        if (decision.startsWith("update:")) {
          if (!options.confirmOverwrite) {
            summary.skipped++;
            summary.errors.push(`Row ${item.index}: overwrite not confirmed — skipped`);
            continue;
          }
          const id = decision.slice(7);
          await prisma.publicBreakdown.update({
            where: { id },
            data: {
              submissionDeadline: v.deadline,
              visibility: v.visibility,
              sourceUrl: v.url,
              characterDescription: v.characterDescription,
              ageRange: v.ageRange,
              gender: v.gender,
              ethnicity: v.ethnicity,
              unionStatus: v.union,
              verifiedAt: options.markVerified ? ctx.now : undefined,
            },
          });
          summary.saved++;
          summary.createdIds.push(id);
          continue;
        }
        const projectId = decision.startsWith("attach:") ? decision.slice(7) : null;
        if (!projectId && (await findDuplicateBreakdown(null, v.project, v.role, v.date))) {
          summary.skipped++;
          continue;
        }
        const b = await createBreakdown({
          projectId,
          project: v.project,
          platform: v.platform,
          productionType: v.productionType,
          unionStatus: v.union,
          region: v.region,
          castingDirector: v.castingDirector,
          castingOffice: v.castingOffice,
          roleName: v.role,
          roleType: v.roleType,
          characterDescription: v.characterDescription,
          ageRange: v.ageRange,
          gender: v.gender,
          ethnicity: v.ethnicity,
          postedDate: v.date,
          submissionDeadline: v.deadline,
          visibility: v.visibility,
          source: v.source,
          sourceUrl: v.url,
          verified: options.markVerified,
        });
        summary.saved++;
        summary.createdIds.push(b.id);
      } catch (e) {
        summary.errors.push(`Row ${item.index}: ${(e as Error).message}`);
      }
    }
    return summary;
  },
};

export type PublicNormalized = NormalizedResult<PublicRow>;
