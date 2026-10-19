import { getActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { describeDevice } from "@/lib/device";

export const dynamic = "force-dynamic";

/** Records a page a sales rep opened (for the coordinator's activity log). Coordinators aren't tracked. */
export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) return new Response(null, { status: 401 });
  if (actor.role !== "REP") return new Response(null, { status: 204 });
  let path = "";
  try {
    path = String((await req.json()).path ?? "");
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 300) return new Response(null, { status: 400 });
  // ignore an immediate repeat of the same page (refreshes, double renders)
  const last = await prisma.pageView.findFirst({ where: { userId: actor.id }, orderBy: { createdAt: "desc" }, select: { path: true, createdAt: true } });
  if (last && last.path === path && Date.now() - last.createdAt.getTime() < 15_000) return new Response(null, { status: 204 });
  await prisma.pageView.create({ data: { userId: actor.id, path, device: describeDevice(req.headers.get("user-agent")) } });
  return new Response(null, { status: 204 });
}
