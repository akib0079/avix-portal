import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { saveUpload } from "@/lib/uploads";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const result = await saveUpload("images", file);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await prisma.imageUpload.create({
    data: {
      fileName: result.fileName,
      originalName: file.name.slice(0, 255),
      mimeType: result.mimeType,
      size: result.size,
      uploaderId: session.user.id,
    },
  });

  return NextResponse.json({ url: `/api/files/image/${result.fileName}` });
}
