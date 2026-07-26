import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { exchangeAndStore } from "@/lib/google-calendar";
import { appUrl } from "@/lib/app-url";

export async function GET(request: Request) {
  const settings = (status: string) => NextResponse.redirect(`${appUrl()}/admin/settings?gcal=${status}`);

  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") {
    return new NextResponse(null, { status: 403 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("gcal_oauth_state="))
    ?.split("=")[1];

  if (url.searchParams.get("error") || !code) return settings("error");
  if (!state || !cookieState || state !== cookieState) return settings("error");

  const result = await exchangeAndStore(code);
  const res = settings(result.ok ? "connected" : "error");
  res.cookies.set("gcal_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
