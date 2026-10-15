"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { checkEmail } from "@/lib/server/email";
import { fid } from "@/lib/server/forms";

export async function checkEmailAction() {
  await requireUser();
  const r = await checkEmail();
  revalidatePath("/", "layout");
  redirect(`/inbox?${r.ok ? "msg" : "error"}=${encodeURIComponent(r.message)}`);
}

export async function dismissEmailAction(fd: FormData) {
  await requireUser();
  await prisma.emailMessage.update({ where: { id: fid(fd) }, data: { status: "DISMISSED" } });
  revalidatePath("/inbox");
}

export async function switchEmailKindAction(fd: FormData) {
  await requireUser();
  const e = await prisma.emailMessage.findUniqueOrThrow({ where: { id: fid(fd) } });
  const { parseAgencyText, parseListingText } = await import("@/lib/listing/parse");
  const kind = e.kind === "AGENCY_SUBMISSION" ? "CASTING_NOTICE" : "AGENCY_SUBMISSION";
  const parsed = kind === "AGENCY_SUBMISSION" ? parseAgencyText(e.bodyText, { subject: e.subject, receivedAt: e.receivedAt }) : parseListingText(e.bodyText, { subject: e.subject });
  await prisma.emailMessage.update({ where: { id: e.id }, data: { kind, parsed: parsed as object } });
  revalidatePath("/inbox");
}
