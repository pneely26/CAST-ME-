import { getActor } from "@/server/auth";
import { getVisitForFile } from "@/server/services/visits";
import { readStored } from "@/server/storage";
import { AppError } from "@/server/errors";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  try {
    const v = await getVisitForFile(actor, (await params).id);
    if (!v.attachmentPath) return new Response("Not found", { status: 404 });
    const buf = await readStored(v.attachmentPath);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": v.attachmentMime ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${(v.attachmentName ?? "attachment").replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "FORBIDDEN" ? 403 : 404 });
    throw e;
  }
}
