import { NextResponse } from "next/server";
import { openUpload, contentTypeFor } from "@/lib/uploads";

/**
 * Public route serving admin-uploaded branding assets (logo, favicon).
 * These are non-sensitive and appear on the login page + as the favicon,
 * so no auth. The file name is a UUID we generated (validated in openUpload).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const data = await openUpload("branding", name);
  if (!data) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentTypeFor(name),
      "Cache-Control": "public, max-age=3600, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
