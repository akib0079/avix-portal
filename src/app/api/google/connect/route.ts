import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSession } from "@/lib/dal/session";
import { buildConsentUrl } from "@/lib/google-calendar";
import { appUrl } from "@/lib/app-url";

export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") {
    return new NextResponse(null, { status: 403 });
  }

  const state = randomBytes(16).toString("hex");
  const url = buildConsentUrl(state);
  if (!url) {
    return NextResponse.redirect(`${appUrl()}/admin/settings?gcal=unconfigured`);
  }

  const res = NextResponse.redirect(url);
  // Short-lived CSRF cookie checked on the callback.
  res.cookies.set("gcal_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
