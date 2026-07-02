import "server-only";
import { prisma } from "@/lib/prisma";

export async function getNotificationsForUser(userId: string) {
  const [unreadCount, notifications] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  return { unreadCount, notifications };
}

export async function notifyAllAdmins(input: {
  type: "TASK_REQUEST_SUBMITTED";
  title: string;
  body?: string;
  link?: string;
}) {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  if (admins.length === 0) return;
  await prisma.notification.createMany({
    data: admins.map((admin) => ({ userId: admin.id, ...input })),
  });
}
