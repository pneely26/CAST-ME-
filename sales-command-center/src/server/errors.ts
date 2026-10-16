/** Errors thrown by services. Server actions turn them into user-facing messages. */
export class AppError extends Error {
  constructor(message: string, public code: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "UNAUTHENTICATED", public details?: Record<string, unknown>) {
    super(message);
  }
}
export const forbidden = (msg = "You don't have permission to do that.") => new AppError(msg, "FORBIDDEN");
export const notFound = (what = "Record") => new AppError(`${what} not found.`, "NOT_FOUND");
export const invalid = (msg: string, details?: Record<string, unknown>) => new AppError(msg, "VALIDATION", details);
export const conflict = (msg: string, details?: Record<string, unknown>) => new AppError(msg, "CONFLICT", details);

export type ActionResult<T = undefined> = { ok: true; data: T; message?: string; redirect?: string } | { ok: false; error: string; code?: string; details?: Record<string, unknown> };

export function toResult(e: unknown): { ok: false; error: string; code?: string; details?: Record<string, unknown> } {
  if (e instanceof AppError) return { ok: false, error: e.message, code: e.code, details: e.details };
  if (e && typeof e === "object" && "issues" in e) {
    const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues;
    return { ok: false, error: issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; "), code: "VALIDATION" };
  }
  // Next.js redirect/notFound must propagate
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
  console.error(e);
  return { ok: false, error: "Something went wrong. Please try again.", code: "INTERNAL" };
}
