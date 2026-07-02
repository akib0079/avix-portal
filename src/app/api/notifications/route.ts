import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { getNotificationsForUser } from "@/lib/dal/notifications";
import { countPendingTaskRequests } from "@/lib/dal/task-requests";

export async function GET() {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { unreadCount, notifications } = await getNotificationsForUser(
    session.user.id,
  );
  const pendingTaskRequests =
    session.user.role === "ADMIN" ? await countPendingTaskRequests() : 0;

  return NextResponse.json({
    unreadCount,
    pendingTaskRequests,
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
  });
}
