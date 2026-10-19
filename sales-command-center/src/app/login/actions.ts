"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { login } from "@/server/auth";
import { describeDevice } from "@/lib/device";

export async function loginAction(_prev: { error?: string; email?: string } | undefined, fd: FormData): Promise<{ error?: string; email?: string }> {
  const email = String(fd.get("email") ?? "").slice(0, 200);
  const password = String(fd.get("password") ?? "").slice(0, 200);
  const h = await headers();
  const client = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const r = await login(email, password, client, describeDevice(h.get("user-agent")));
  if (!r.ok) return { error: r.error, email };
  const next = String(fd.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
