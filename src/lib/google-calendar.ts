import "server-only";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/app-url";

/**
 * Google Calendar sync (v20) — deliberately ISOLATED from better-auth's Google
 * sign-in. A dedicated OAuth consent (calendar scope, offline) stores a refresh
 * token in AppSettings; everything here is best-effort and a no-op until the
 * admin connects, so it can never break meeting creation or the running app.
 * Uses the Calendar REST API over fetch — no heavy client library.
 */

export const GCAL_REFRESH_KEY = "googleCalRefreshToken";
export const GCAL_ID_KEY = "googleCalId";
export const GCAL_EMAIL_KEY = "googleCalEmail";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

function creds() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}

export function redirectUri(): string {
  return `${appUrl()}/api/google/callback`;
}

async function setting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value || null;
}

export async function calendarStatus(): Promise<{ connected: boolean; email: string | null; calendarId: string }> {
  const [refresh, email, cal] = await Promise.all([
    setting(GCAL_REFRESH_KEY),
    setting(GCAL_EMAIL_KEY),
    setting(GCAL_ID_KEY),
  ]);
  return { connected: !!refresh, email, calendarId: cal || "primary" };
}

/** The consent URL to start connecting a calendar. `state` is a CSRF nonce. */
export function buildConsentUrl(state: string): string | null {
  const { clientId } = creds();
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Exchange the OAuth code for tokens and persist the refresh token. */
export async function exchangeAndStore(code: string): Promise<{ ok: boolean; error?: string }> {
  const { clientId, clientSecret } = creds();
  if (!clientId || !clientSecret) return { ok: false, error: "Google credentials are not configured." };

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return { ok: false, error: `Token exchange failed (${res.status}).` };
  const data = (await res.json()) as { refresh_token?: string; access_token?: string };
  if (!data.refresh_token) {
    return { ok: false, error: "Google did not return a refresh token — remove app access and reconnect." };
  }

  // Best-effort: read the connected account's email for display.
  let email: string | null = null;
  try {
    if (data.access_token) {
      const info = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (info.ok) email = ((await info.json()) as { email?: string }).email ?? null;
    }
  } catch {
    /* ignore */
  }

  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: GCAL_REFRESH_KEY },
      create: { key: GCAL_REFRESH_KEY, value: data.refresh_token },
      update: { value: data.refresh_token },
    }),
    prisma.appSetting.upsert({
      where: { key: GCAL_EMAIL_KEY },
      create: { key: GCAL_EMAIL_KEY, value: email ?? "" },
      update: { value: email ?? "" },
    }),
  ]);
  return { ok: true };
}

export async function disconnectCalendar(): Promise<void> {
  await prisma.appSetting.deleteMany({
    where: { key: { in: [GCAL_REFRESH_KEY, GCAL_EMAIL_KEY] } },
  });
}

async function accessToken(): Promise<string | null> {
  const { clientId, clientSecret } = creds();
  const refresh = await setting(GCAL_REFRESH_KEY);
  if (!clientId || !clientSecret || !refresh) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { access_token?: string }).access_token ?? null;
  } catch {
    return null;
  }
}

type MeetingLike = {
  id: string;
  title: string;
  notes: string | null;
  startsAt: Date;
  durationMins: number;
  meetingUrl: string | null;
  googleEventId?: string | null;
};

function eventBody(m: MeetingLike, attendeeEmail?: string | null) {
  const end = new Date(m.startsAt.getTime() + m.durationMins * 60_000);
  return {
    summary: m.title,
    description: m.notes ?? undefined,
    location: m.meetingUrl ?? undefined,
    start: { dateTime: m.startsAt.toISOString() },
    end: { dateTime: end.toISOString() },
    ...(attendeeEmail ? { attendees: [{ email: attendeeEmail }] } : {}),
  };
}

/**
 * Push a meeting to Google Calendar (create or update). Returns the event id,
 * or null when not connected / on any error. NEVER throws — callers store the
 * returned id but proceed regardless.
 */
export async function pushMeeting(
  m: MeetingLike,
  attendeeEmail?: string | null,
): Promise<string | null> {
  const token = await accessToken();
  if (!token) return null;
  const cal = encodeURIComponent((await setting(GCAL_ID_KEY)) || "primary");
  try {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${cal}/events`;
    const url = m.googleEventId ? `${base}/${encodeURIComponent(m.googleEventId)}` : base;
    const res = await fetch(url, {
      method: m.googleEventId ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(eventBody(m, attendeeEmail)),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { id?: string }).id ?? null;
  } catch {
    return null;
  }
}

/** Delete a meeting's Google Calendar event. Best-effort. */
export async function deleteEvent(eventId: string): Promise<void> {
  const token = await accessToken();
  if (!token) return;
  const cal = encodeURIComponent((await setting(GCAL_ID_KEY)) || "primary");
  try {
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
  } catch {
    /* ignore */
  }
}

/**
 * Inbound reconcile: for future portal meetings that were mirrored to Google,
 * cancel any whose Google event is now gone or marked cancelled. Returns the
 * number cancelled. Best-effort; the ICS/email path remains the source of truth
 * the client already has. Admin-triggered (no background cron).
 */
export async function reconcileFromGoogle(): Promise<{ ok: boolean; cancelled: number; error?: string }> {
  const token = await accessToken();
  if (!token) return { ok: false, cancelled: 0, error: "Calendar not connected." };
  const cal = encodeURIComponent((await setting(GCAL_ID_KEY)) || "primary");

  const meetings = await prisma.meeting.findMany({
    where: { status: "SCHEDULED", googleEventId: { not: null }, startsAt: { gte: new Date() } },
    select: { id: true, googleEventId: true },
  });

  let cancelled = 0;
  for (const mtg of meetings) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${encodeURIComponent(mtg.googleEventId!)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const gone = res.status === 404 || res.status === 410;
      const declined = res.ok && ((await res.json()) as { status?: string }).status === "cancelled";
      if (gone || declined) {
        await prisma.meeting.update({ where: { id: mtg.id }, data: { status: "CANCELLED" } });
        cancelled++;
      }
    } catch {
      /* skip this one */
    }
  }
  return { ok: true, cancelled };
}
