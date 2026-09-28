import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken, verifySessionToken } from "../session";

// Simple in-memory login throttle (single-user app, single process).
const attempts = new Map<string, { count: number; until: number }>();

export function authConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD_HASH && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32);
}

export async function checkCredentials(username: string, password: string, clientKey: string): Promise<{ ok: boolean; error?: string }> {
  const now = Date.now();
  const a = attempts.get(clientKey);
  if (a && a.until > now) return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  const expectedUser = process.env.APP_USERNAME ?? "paige";
  // Accept hashes whose "$" were escaped for dotenv.
  const hash = (process.env.APP_PASSWORD_HASH ?? "").replace(/\\\$/g, "$");
  const ok = username.trim().toLowerCase() === expectedUser.toLowerCase() && hash.length > 0 && (await bcrypt.compare(password, hash));
  if (!ok) {
    const count = (a?.count ?? 0) + 1;
    attempts.set(clientKey, { count, until: count >= 5 ? now + 5 * 60_000 : 0 });
    return { ok: false, error: "Invalid username or password." };
  }
  attempts.delete(clientKey);
  return { ok: true };
}

export async function startSession(username: string) {
  const token = await createSessionToken(username);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Defense in depth: every server action/route handler calls this in addition to middleware. */
export async function requireUser(): Promise<string> {
  const user = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  return user;
}
