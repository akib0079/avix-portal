import { NextResponse } from "next/server";

/**
 * Image FILE uploads are disabled — images are added by URL in the editor
 * (Google Drive / Dropbox share links are normalized to direct-view URLs).
 * Existing uploads still render via /api/files/image/[fileName].
 */
export async function POST() {
  return NextResponse.json(
    { error: "Image uploads are disabled — paste an image URL instead." },
    { status: 410 },
  );
}
