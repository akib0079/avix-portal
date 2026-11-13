import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCookieCache } from "better-auth/cookies";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/dal/session";
import { getClientPoll, getNotificationsForUser } from "@/lib/dal/notifications";
import { countPendingTaskRequests } from "@/lib/dal/task-requests";
import { countWaiting } from "@/lib/work-scope";
import { prisma } from "@/lib/prisma";

/**
 * The session cookie cache lives 5 minutes. Past 4, the poll renews it from
 * the database (one statement, here in the background), so a visible tab
 * never lets it lapse and its next page load never pays the session lookup.
 */
const COOKIE_RENEW_AFTER_MS = 240_000;

async function pollSession(request: Request) {
  const baseUrl = process.env.BETTER_AUTH_URL;
  const cached = await getCookieCache(request, {
    // The same rule better-auth names its cookies by.
    isSecure: baseUrl ? baseUrl.startsWith("https://") : undefined,
    secret: process.env.BETTER_AUTH_SECRET,
  }).catch(() => null);
  if (cached && Date.now() - cached.updatedAt < COOKIE_RENEW_AFTER_MS) return getSession();
  // nextCookies writes the fresh session_data cookie onto this response.
  return auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
}

export async function GET(request: Request) {
  const session = await pollSession(request);
  if (!session || session.user.status === "INACTIVE") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Every open tab polls this every 30s. A client's answer is one statement on
  // their own row; the team's reads are independent, so they go out together.
  if (session.user.role === "CLIENT") {
    const row = await getClientPoll(session.user.id);
    if (!row || row.status === "INACTIVE") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({
      unreadCount: row._count.notifications,
      pendingTaskRequests: 0,
      pendingActions: countWaiting(row),
      unreadMessages: row._count.clientMessages,
      notifications: row.notifications.map(toJson),
    });
  }

  const [{ unreadCount, notifications }, pendingTaskRequests, unreadMessages] = await Promise.all([
    getNotificationsForUser(session.user.id),
    // The team decides requests (staff at no charge), so both see the count.
    countPendingTaskRequests(),
    // Unread chat, so Messages can carry a badge like Requests does.
    prisma.message.count({ where: { senderRole: "CLIENT", readByAdminAt: null } }),
  ]);

  return NextResponse.json({
    unreadCount,
    pendingTaskRequests,
    pendingActions: 0,
    unreadMessages,
    notifications: notifications.map(toJson),
  });
}

function toJson(n: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}
