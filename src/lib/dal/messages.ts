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
 * A thread is (clientId, projectId). projectId === null is the client's
 * GENERAL thread — chatting with us without picking a project.
 */
export type ThreadKey = { clientId: string; projectId: string | null };

function toView(m: {
  id: string;
  senderId: string;
  senderRole: MessageSenderRole;
  body: unknown;
  createdAt: Date;
  sender: { firstName: string; lastName: string; name: string };
}): MessageView {
  return {
    id: m.id,
    senderId: m.senderId,
    senderRole: m.senderRole,
    senderName: `${m.sender.firstName} ${m.sender.lastName}`.trim() || m.sender.name,
    body: (m.body as JSONContent) ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

const senderSelect = {
  sender: { select: { firstName: true, lastName: true, name: true } },
} as const;

/**
 * Loads one thread's messages. Callers MUST authorize the thread first
 * (admin: any client; client: only their own id).
 */
export async function getThreadMessages(key: ThreadKey): Promise<MessageView[]> {
  const rows = await prisma.message.findMany({
    where: { clientId: key.clientId, projectId: key.projectId },
    orderBy: { createdAt: "asc" },
    include: senderSelect,
  });
  return rows.map(toView);
}

/** Project thread (used by the admin + portal project pages). */
export async function getProjectMessages(projectId: string): Promise<MessageView[]> {
  const rows = await prisma.message.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    include: senderSelect,
  });
  return rows.map(toView);
}

export type ConversationSummary = {
  clientId: string;
  clientName: string;
  company: string | null;
  timezone: string | null;
  projectId: string | null;
  projectName: string | null;
  lastMessageAt: string;
  preview: string;
  unread: number;
};

/** Flattens Tiptap JSON to a short plain-text preview. */
function preview(doc: unknown, max = 90): string {
  const parts: string[] = [];
  const walk = (node: { text?: string; content?: unknown[] }) => {
    if (node.text) parts.push(node.text);
    if (Array.isArray(node.content))
      node.content.forEach((c) => walk(c as { text?: string; content?: unknown[] }));
  };
  walk((doc as { content?: unknown[] }) ?? {});
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text || "(no text)";
}

/**
 * Admin inbox: one row per thread (client × project|general), newest first,
 * with a count of client messages the admin hasn't read yet.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  const rows = await prisma.message.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: {
        select: { id: true, firstName: true, lastName: true, company: true, timezone: true },
      },
      project: { select: { id: true, projectName: true } },
    },
  });

  const threads = new Map<string, ConversationSummary>();
  for (const m of rows) {
    const key = `${m.clientId}::${m.projectId ?? "general"}`;
    const isUnread = m.senderRole === "CLIENT" && m.readByAdminAt === null;
    const existing = threads.get(key);

    if (!existing) {
      // Rows are newest-first, so the first one seen is the latest message.
      threads.set(key, {
        clientId: m.clientId,
        clientName: `${m.client.firstName} ${m.client.lastName}`.trim() || "Client",
        company: m.client.company,
        timezone: m.client.timezone,
        projectId: m.projectId,
        projectName: m.project?.projectName ?? null,
        lastMessageAt: m.createdAt.toISOString(),
        preview: `${m.senderRole === "ADMIN" ? "You: " : ""}${preview(m.body)}`,
        unread: isUnread ? 1 : 0,
      });
    } else if (isUnread) {
      existing.unread += 1;
    }
  }

  return [...threads.values()].sort(
    (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt),
  );
}

/** Client's thread list: General + one per project, each with unread counts. */
export async function listMyThreads(clientId: string) {
  const [projects, unreadRows] = await Promise.all([
    prisma.project.findMany({
      where: { clientId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, projectName: true },
    }),
    prisma.message.findMany({
      where: { clientId, senderRole: "ADMIN", readByClientAt: null },
      select: { projectId: true },
    }),
  ]);

  const unreadByThread = new Map<string, number>();
  for (const row of unreadRows) {
    const key = row.projectId ?? "general";
    unreadByThread.set(key, (unreadByThread.get(key) ?? 0) + 1);
  }

  return {
    generalUnread: unreadByThread.get("general") ?? 0,
    projects: projects.map((p) => ({
      id: p.id,
      projectName: p.projectName,
      unread: unreadByThread.get(p.id) ?? 0,
    })),
  };
}
