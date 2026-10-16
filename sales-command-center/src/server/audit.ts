import type { Prisma } from "@prisma/client";
import type { Tx } from "./db";
import type { Actor } from "./policy";

/** Record an important change. Events with a leadId also appear on that lead's activity timeline. */
export async function audit(
  tx: Tx,
  actor: Actor | null,
  action: string,
  entity: { type: string; id?: string | null; leadId?: string | null },
  summary: string,
  data?: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: { actorId: actor?.id ?? null, action, entityType: entity.type, entityId: entity.id ?? null, leadId: entity.leadId ?? null, summary, data },
  });
}

/** Field-level diff for edits: { field: [before, after] } */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v && typeof v === "object" && "toFixed" in (v as object) ? String(v) : Array.isArray(v) ? JSON.stringify(v) : (v ?? null));
    if (norm(a) !== norm(b)) out[k] = [norm(a), norm(b)];
  }
  return out;
}
