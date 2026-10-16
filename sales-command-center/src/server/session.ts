// Edge-safe signed session token (used by middleware and server code).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "scc_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

export interface SessionClaims {
  uid: string;
  role: "COORDINATOR" | "REP";
  sv: number; // session version — must match User.sessionVersion
}

function key(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to 32+ random characters.");
  return new TextEncoder().encode(s);
}

export async function signSession(c: SessionClaims): Promise<string> {
  return new SignJWT({ role: c.role, sv: c.sv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.uid)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || (payload.role !== "COORDINATOR" && payload.role !== "REP")) return null;
    return { uid: payload.sub, role: payload.role, sv: Number(payload.sv ?? 0) };
  } catch {
    return null;
  }
}
