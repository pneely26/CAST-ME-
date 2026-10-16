import { NextResponse } from "next/server";
import { getActor } from "@/server/auth";
import { prisma } from "@/server/db";

/** Mark one of your notifications read and go to what it's about. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const url = new URL(req.url);
  if (!actor) return NextResponse.redirect(new URL("/login", url));
  const n = await prisma.notification.findFirst({ where: { id: (await params).id, userId: actor.id } });
  if (!n) return NextResponse.redirect(new URL("/notifications", url));
  if (!n.readAt) await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  const target = n.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : "/notifications";
  return NextResponse.redirect(new URL(target, url), 303);
}
