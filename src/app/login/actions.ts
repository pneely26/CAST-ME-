"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkCredentials, startSession, authConfigured } from "@/lib/server/auth";

export async function loginAction(_prev: { error?: string; username?: string } | undefined, formData: FormData): Promise<{ error?: string; username?: string }> {
  if (!authConfigured()) return { error: "Authentication is not configured. Set APP_PASSWORD_HASH and SESSION_SECRET in .env." };
  const username = String(formData.get("username") ?? "").slice(0, 100);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  const h = await headers();
  const client = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  const r = await checkCredentials(username, password, client);
  if (!r.ok) return { error: r.error, username };
  await startSession(username);
  const next = String(formData.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
