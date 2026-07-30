import { NextResponse } from "next/server";
import { runDueDuties } from "@/lib/duties";

/**
 * External trigger for the duties engine (meeting reminders, retainer drafts,
 * campaign sends).
 *
 * Why this exists: runDueDuties() normally piggybacks on admin page loads, so a
 * campaign scheduled for 3am wouldn't move until someone opened the app. Point
 * any external pinger (cron-job.org, UptimeRobot, a real crontab) at this route
 * every few minutes and scheduled work runs on time.
 *
 * Safe to call repeatedly: every duty is idempotent and the engine keeps its own
 * 15-minute throttle, so extra calls are cheap no-ops.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured on the server." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-cron-secret") ?? url.searchParams.get("key") ?? "";
  if (provided !== secret) {
    return new NextResponse(null, { status: 401 });
  }

  await runDueDuties();
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
}
