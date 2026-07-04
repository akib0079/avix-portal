import "server-only";
import { prisma } from "@/lib/prisma";
import type { JSONContent } from "@tiptap/react";
import type { MessageSenderRole } from "@prisma/client";

export type MessageView = {
  id: string;
  senderId: string;
  senderRole: MessageSenderRole;
  senderName: string;
  body: JSONContent | null;
  createdAt: string;
};

/**
 * Loads a project's message thread. Callers MUST first authorize access to the
 * project (admin: any project; client: findFirst scoped to their id).
 */
export async function getProjectMessages(projectId: string): Promise<MessageView[]> {
  const rows = await prisma.message.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    include: { sender: { select: { firstName: true, lastName: true, name: true } } },
  });
  return rows.map((m) => ({
    id: m.id,
    senderId: m.senderId,
    senderRole: m.senderRole,
    senderName:
      `${m.sender.firstName} ${m.sender.lastName}`.trim() || m.sender.name,
    body: (m.body as JSONContent) ?? null,
    createdAt: m.createdAt.toISOString(),
  }));
}
