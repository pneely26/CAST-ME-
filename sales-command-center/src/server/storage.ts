/**
 * File storage for visit attachments and import screenshots. Files are kept on local disk
 * (UPLOAD_DIR, default ./uploads), outside the public folder, and served only through
 * permission-checked routes. Swap this module for S3/Supabase Storage in production if needed.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { invalid } from "./errors";

export const ROOT = path.resolve(process.env.UPLOAD_DIR || "./uploads");

const ALLOWED: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "image/heic": [".heic"],
  "application/pdf": [".pdf"],
};

/** Check magic bytes so a renamed file can't pretend to be an image/PDF. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (buf.subarray(4, 12).toString("ascii").startsWith("ftyphei") || buf.subarray(4, 12).toString("ascii").startsWith("ftypmif")) return "image/heic";
  if (buf.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return null;
}

export interface StoredFile {
  path: string; // relative to ROOT
  name: string;
  mime: string;
  size: number;
  sha256: string;
}

export async function saveUpload(file: File, folder: string, opts: { maxBytes?: number; imagesOnly?: boolean } = {}): Promise<StoredFile> {
  const max = opts.maxBytes ?? 10 * 1024 * 1024;
  if (file.size === 0) throw invalid(`${file.name} is empty.`);
  if (file.size > max) throw invalid(`${file.name} is larger than ${Math.round(max / 1024 / 1024)} MB.`);
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf);
  if (!mime || (opts.imagesOnly && !mime.startsWith("image/"))) throw invalid(`${file.name}: unsupported file type. Use ${opts.imagesOnly ? "PNG, JPEG, WebP or GIF images" : "an image or PDF"}.`);
  const ext = ALLOWED[mime][0];
  const safeFolder = folder.replace(/[^a-z0-9/_-]/gi, "_");
  const rel = path.join(safeFolder, `${randomUUID()}${ext}`);
  const abs = path.join(ROOT, rel);
  if (!abs.startsWith(ROOT + path.sep)) throw invalid("Invalid storage path.");
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf, { mode: 0o600 });
  return { path: rel, name: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120), mime, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
}

export async function readStored(rel: string): Promise<Buffer> {
  const abs = path.resolve(ROOT, rel);
  if (!abs.startsWith(ROOT + path.sep)) throw invalid("Invalid path.");
  return readFile(abs);
}
