import { NextResponse } from "next/server";
import { getActor, logout } from "@/server/auth";
import { prisma } from "@/server/db";
import { describeDevice } from "@/lib/device";

export async function POST(req: Request) {
  const actor = await getActor();
  if (actor) {
    const device = describeDevice(req.headers.get("user-agent"));
    await prisma.auditLog.create({ data: { actorId: actor.id, action: "auth.logout", entityType: "User", entityId: actor.id, summary: `Signed out · ${device}`, data: { device } } }).catch(() => {});
  }
  await logout();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
