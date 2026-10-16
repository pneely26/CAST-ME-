import { getActor } from "@/server/auth";
import { getImageForFile } from "@/server/services/imports";
import { readStored } from "@/server/storage";
import { AppError } from "@/server/errors";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  try {
    const img = await getImageForFile(actor, (await params).id);
    const buf = await readStored(img.path);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": img.mimeType,
        "Content-Disposition": `inline; filename="${img.fileName.replace(/"/g, "")}"`,
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
