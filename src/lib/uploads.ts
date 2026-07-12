import "server-only";
import "@/lib/load-persistent-env"; // apply durable env (UPLOAD_DIR, …) first
import { mkdir, writeFile, unlink, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * File storage with two backends:
 *  - Supabase Storage (when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set)
 *    — used on hosts without a persistent disk (e.g. Hostinger web apps).
 *  - Local disk under UPLOAD_DIR — used in local dev and on the VPS.
 * Files are private either way and only ever served through the
 * auth-checked /api/files/* routes.
 */

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "uploads";

// Read lazily so the durable-env loader's UPLOAD_DIR is picked up regardless
// of module import order. Defaults to a home-dir folder that survives Hostinger
// redeploys (the app dir is rebuilt on every deploy — never store there).
function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
}

export type UploadKind = "invoices" | "images" | "branding";

const limits: Record<UploadKind, number> = {
  invoices: 25 * 1024 * 1024, // 25 MB
  images: 5 * 1024 * 1024, // 5 MB
  branding: 2 * 1024 * 1024, // 2 MB (logo / favicon)
};

const imageTypes: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// ---------- Supabase backend ----------

let supabase: SupabaseClient | null = null;
let bucketReady = false;

function getSupabase(): SupabaseClient | null {
  // Explicit backend override — STORAGE_BACKEND=disk forces local/home-dir
  // disk even if Supabase keys are present in the environment.
  if ((process.env.STORAGE_BACKEND ?? "").toLowerCase() === "disk") return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!supabase) {
    supabase = createClient(url, key, { auth: { persistSession: false } });
  }
  return supabase;
}

async function ensureBucket(client: SupabaseClient) {
  if (bucketReady) return;
  const { data } = await client.storage.getBucket(BUCKET);
  if (!data) {
    await client.storage.createBucket(BUCKET, { public: false });
  }
  bucketReady = true;
}

// ---------- Validation ----------

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

// ---------- Public API ----------

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
  } else if (kind === "branding") {
    // Logo / favicon — PNG, JPEG, WebP, or SVG. SVG isn't magic-byte checked
    // (text format) so it's validated by a leading `<` below.
    if (file.type === "image/svg+xml") {
      ext = "svg";
      mimeType = "image/svg+xml";
    } else {
      const mapped = imageTypes[file.type];
      if (!mapped) {
        return { ok: false, error: "Use a PNG, JPEG, WebP, or SVG image." };
      }
      ext = mapped;
      mimeType = file.type;
    }
  } else {
    const mapped = imageTypes[file.type];
    if (!mapped) {
      return { ok: false, error: "Only PNG, JPEG, or WebP images are allowed." };
    }
    ext = mapped;
    mimeType = file.type;
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const svg = mimeType === "image/svg+xml";
  if (svg) {
    const head = buf.subarray(0, 512).toString("utf8").trimStart();
    if (!head.startsWith("<")) {
      return { ok: false, error: "The file content doesn't match its type." };
    }
  } else if (!hasMagicBytes(buf, kind === "branding" ? "images" : kind, mimeType)) {
    return { ok: false, error: "The file content doesn't match its type." };
  }

  const fileName = `${randomUUID()}.${ext}`;

  const client = getSupabase();
  if (client) {
    await ensureBucket(client);
    const { error } = await client.storage
      .from(BUCKET)
      .upload(`${kind}/${fileName}`, buf, { contentType: mimeType });
    if (error) {
      console.error("[uploads] supabase upload failed:", error.message);
      return { ok: false, error: "Upload failed — try again." };
    }
  } else {
    // Local/home-dir disk. Surface a clean error instead of a 500 if the
    // directory isn't writable (wrong UPLOAD_DIR / permissions on the host).
    try {
      const dir = path.join(uploadRoot(), kind);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, fileName), buf);
    } catch (err) {
      console.error("[uploads] disk write failed:", (err as Error).message);
      return {
        ok: false,
        error: "Couldn't save the file on the server — check storage settings.",
      };
    }
  }

  return { ok: true, fileName, size: buf.length, mimeType };
}

function validName(fileName: string): boolean {
  // Names are always `${uuid}.${ext}` that we generated ourselves.
  return /^[a-f0-9-]{36}\.(pdf|png|jpg|webp|svg)$/i.test(fileName);
}

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

/** MIME type for a stored file name, for the public branding route. */
export function contentTypeFor(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Returns the file bytes, or null when missing/not accessible. */
export async function openUpload(
  kind: UploadKind,
  fileName: string,
): Promise<Buffer | null> {
  if (!validName(fileName)) return null;

  const client = getSupabase();
  if (client) {
    await ensureBucket(client);
    const { data, error } = await client.storage
      .from(BUCKET)
      .download(`${kind}/${fileName}`);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  const root = uploadRoot();
  const filePath = path.join(root, kind, fileName);
  if (!filePath.startsWith(root) || !existsSync(filePath)) return null;
  return readFile(filePath).catch(() => null);
}

export async function deleteUpload(kind: UploadKind, fileName: string) {
  if (!validName(fileName)) return;

  const client = getSupabase();
  if (client) {
    await ensureBucket(client);
    await client.storage.from(BUCKET).remove([`${kind}/${fileName}`]);
    return;
  }

  const root = uploadRoot();
  const filePath = path.join(root, kind, fileName);
  if (!filePath.startsWith(root)) return;
  await unlink(filePath).catch(() => {});
}
