import "server-only";
import { mkdir, writeFile, unlink } from "fs/promises";
import { createReadStream, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");

export type UploadKind = "invoices" | "images";

const limits: Record<UploadKind, number> = {
  invoices: 10 * 1024 * 1024, // 10 MB
  images: 5 * 1024 * 1024, // 5 MB
};

const imageTypes: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function hasMagicBytes(buf: Buffer, kind: UploadKind, mime: string): boolean {
  if (kind === "invoices") {
    return buf.subarray(0, 5).toString("latin1") === "%PDF-";
  }
  switch (mime) {
    case "image/png":
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/webp":
      return (
        buf.subarray(0, 4).toString("latin1") === "RIFF" &&
        buf.subarray(8, 12).toString("latin1") === "WEBP"
      );
    default:
      return false;
  }
}

export type SaveResult =
  | { ok: true; fileName: string; size: number; mimeType: string }
  | { ok: false; error: string };

export async function saveUpload(kind: UploadKind, file: File): Promise<SaveResult> {
  if (file.size === 0) return { ok: false, error: "The file is empty." };
  if (file.size > limits[kind]) {
    return {
      ok: false,
      error: `File is too large — max ${Math.round(limits[kind] / 1024 / 1024)} MB.`,
    };
  }

  let ext: string;
  let mimeType: string;
  if (kind === "invoices") {
    if (file.type !== "application/pdf") {
      return { ok: false, error: "Only PDF files are allowed." };
    }
    ext = "pdf";
    mimeType = "application/pdf";
  } else {
    const mapped = imageTypes[file.type];
    if (!mapped) {
      return { ok: false, error: "Only PNG, JPEG, or WebP images are allowed." };
    }
    ext = mapped;
    mimeType = file.type;
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (!hasMagicBytes(buf, kind, mimeType)) {
    return { ok: false, error: "The file content doesn't match its type." };
  }

  const fileName = `${randomUUID()}.${ext}`;
  const dir = path.join(UPLOAD_ROOT, kind);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), buf);
  return { ok: true, fileName, size: buf.length, mimeType };
}

/** Resolves a stored file safely inside the upload root; null if missing. */
export function resolveUpload(kind: UploadKind, fileName: string): string | null {
  // Defense-in-depth: names are always `${uuid}.${ext}` we generated.
  if (!/^[a-f0-9-]{36}\.(pdf|png|jpg|webp)$/i.test(fileName)) return null;
  const filePath = path.join(UPLOAD_ROOT, kind, fileName);
  if (!filePath.startsWith(UPLOAD_ROOT) || !existsSync(filePath)) return null;
  return filePath;
}

export function fileStream(filePath: string): ReadableStream {
  return Readable.toWeb(createReadStream(filePath)) as ReadableStream;
}

export async function deleteUpload(kind: UploadKind, fileName: string) {
  const filePath = resolveUpload(kind, fileName);
  if (!filePath) return;
  await unlink(filePath).catch(() => {});
}
