import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "./session";
import type { Actor } from "./policy";
import { AppError } from "./errors";

const attempts = new Map<string, { count: number; until: number }>();
let dummyHash: string | null = null;

/** Current signed-in user, re-validated against the database on every request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const claims = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.uid }, select: { id: true, role: true, name: true, active: true, sessionVersion: true } });
  if (!user || !user.active || user.sessionVersion !== claims.sv) return null;
  return { id: user.id, role: user.role, name: user.name };
});

/** For pages: redirect to sign-in. */
export async function requireActor(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  return a;
}

/** For server actions and route handlers: throw instead of redirecting. */
export async function actorOrThrow(): Promise<Actor> {
  const a = await getActor();
  if (!a) throw new AppError("Your session has ended. Please sign in again.", "UNAUTHENTICATED");
  return a;
}

export async function login(email: string, password: string, clientKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = Date.now();
  const k = `${clientKey}:${email.toLowerCase()}`;
  const a = attempts.get(k);
  if (a && a.until > now) return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  // compare against a dummy hash when the user doesn't exist to keep timing similar
  dummyHash ??= bcrypt.hashSync("not-a-real-password", 12);
  const ok = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);
  if (!user || !ok || !user.active) {
    const count = (a?.count ?? 0) + 1;
    attempts.set(k, { count, until: count >= 5 ? now + 5 * 60_000 : 0 });
    return { ok: false, error: user && !user.active ? "This account is deactivated." : "Incorrect email or password." };
  }
  attempts.delete(k);
  await setSessionCookie(user);
  return { ok: true };
}

/** Issue (or re-issue) the signed session cookie for a user. */
export async function setSessionCookie(user: { id: string; role: "COORDINATOR" | "REP"; sessionVersion: number }) {
  const token = await signSession({ uid: user.id, role: user.role, sv: user.sessionVersion });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
}

export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 12);
}
