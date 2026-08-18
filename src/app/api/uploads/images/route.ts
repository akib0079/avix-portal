import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { saveUpload } from "@/lib/uploads";
import { checkImageQuota, reconcileImageQuota } from "@/lib/upload-quota";

/**
 * Image uploads for the rich-text editor: chat messages, project briefs,
 * milestone descriptions, campaign bodies.
 *
 * The FILE goes to storage (the server's own disk on Hostinger, or Supabase
 * when its keys are set — see STORAGE_BACKEND in src/lib/uploads.ts). The
 * database only ever holds the row describing it, and the document only holds
 * the URL, so a thread full of screenshots doesn't bloat Postgres.
 *
 * Anyone signed in may upload — clients paste screenshots into chat too — but
 * saveUpload enforces the type allowlist (png/jpeg/webp), magic-byte checking
 * and the 5 MB cap, so "any signed-in user" is not "any file", and
 * checkImageQuota bounds how many of those files one account can store, so it
 * is not "any number of files" either.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file received." }, { status: 400 });
  }

  // Checked before the bytes are written, so a rejected upload costs no disk.
  const quota = await checkImageQuota(session.user.id, file.size, session.user.role);
  if (!quota.ok) {
    return NextResponse.json(
      { error: quota.error },
      { status: 429, headers: { "Retry-After": String(quota.retryAfterSeconds) } },
    );
  }

  const saved = await saveUpload("images", file);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 400 });
  }

  const row = await prisma.imageUpload.create({
    data: {
      fileName: saved.fileName,
      originalName: file.name.slice(0, 255) || "pasted-image",
      mimeType: saved.mimeType,
      size: saved.size,
      uploaderId: session.user.id,
    },
    select: { id: true, uploaderId: true, fileName: true, size: true, createdAt: true },
  });

  // The pre-check couldn't see the other requests in this burst; this one can.
  // It undoes the upload if too many arrived at once.
  const settled = await reconcileImageQuota(row, session.user.role);
  if (!settled.ok) {
    return NextResponse.json(
      { error: settled.error },
      { status: 429, headers: { "Retry-After": String(settled.retryAfterSeconds) } },
    );
  }

  // The editor stores only this path; the bytes never touch the database.
  return NextResponse.json({
    url: `/api/files/image/${saved.fileName}`,
    name: file.name || "image",
  });
}
