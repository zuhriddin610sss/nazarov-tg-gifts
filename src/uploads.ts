import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { AppError } from "./errors.js";

const MAX = 8 * 1024 * 1024;

/** Faylning haqiqiy turini birinchi baytlaridan aniqlaydi (kengaytmaga ishonilmaydi). */
function sniff(b: Buffer): { mime: string; ext: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (b.length > 5 && b.subarray(0, 5).toString() === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  return null;
}

export async function saveUpload(buf: Buffer, allowPdf: boolean) {
  if (buf.length === 0) throw new AppError("FILE_REQUIRED");
  if (buf.length > MAX) throw new AppError("FILE_TOO_LARGE", 413);
  const t = sniff(buf);
  if (!t || (!allowPdf && t.mime === "application/pdf")) throw new AppError("FILE_TYPE_NOT_ALLOWED", 415);
  await mkdir(config.UPLOAD_DIR, { recursive: true });
  const name = `${Date.now()}-${randomBytes(12).toString("hex")}.${t.ext}`;
  await writeFile(path.join(config.UPLOAD_DIR, name), buf, { mode: 0o600 });
  return { name, mime: t.mime };
}

export function uploadPath(name: string) {
  if (!/^\d+-[a-f0-9]{24}\.(jpg|png|webp|pdf)$/.test(name)) throw new AppError("NOT_FOUND", 404);
  return path.join(config.UPLOAD_DIR, name);
}
