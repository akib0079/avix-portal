import "server-only";
import { prisma } from "@/lib/prisma";
import type { JSONContent } from "@tiptap/react";
import type { MessageSenderRole, MessageVisibility, Role } from "@prisma/client";
import { clipPreview, richTextPreview } from "@/lib/rich-text";

export type MessageView = {
  id: string;
  senderId: string;
  senderRole: MessageSenderRole;
  senderName: string;
  /** True when the sender is a STAFF user — portal shows a "team" tag. */
  senderIsStaff: boolean;
  body: JSONContent | null;
  createdAt: string;
  /** INTERNAL notes are team-only and never reach a client payload. */
  visibility: MessageVisibility;
  /** When the other side read it — drives the "Seen" receipt. */
  readByAdminAt: string | null;
  readByClientAt: string | null;
};

/**
 * A thread is (clientId, projectId). projectId === null is the client's
 * GENERAL thread — chatting with us without picking a project.
 */
export type ThreadKey = { clientId: string; projectId: string | null };

/** One page of a thread, newest-last, plus whether older messages exist. */
export type ThreadPage = {
  messages: MessageView[];
  hasMore: boolean;
};

/** How many messages one page of a thread holds. */
export const THREAD_PAGE_SIZE = 50;
/** How many conversations the admin inbox lists at once. */
export const INBOX_PAGE_SIZE = 50;

function toView(m: {
  id: string;
  senderId: string;
  senderRole: MessageSenderRole;
  body: unknown;
  createdAt: Date;
  visibility: MessageVisibility;
  readByAdminAt: Date | null;
  readByClientAt: Date | null;
  sender: { firstName: string; lastName: string; name: string; role: Role };
}): MessageView {
  return {
    id: m.id,
    senderId: m.senderId,
    senderRole: m.senderRole,
    senderName: `${m.sender.firstName} ${m.sender.lastName}`.trim() || m.sender.name,
    senderIsStaff: m.sender.role === "STAFF",
    body: (m.body as JSONContent) ?? null,
    createdAt: m.createdAt.toISOString(),
    visibility: m.visibility,
    readByAdminAt: m.readByAdminAt?.toISOString() ?? null,
    readByClientAt: m.readByClientAt?.toISOString() ?? null,
  };
}

const senderSelect = {
  sender: { select: { firstName: true, lastName: true, name: true, role: true } },
} as const;

/**
 * Loads one page of a thread. Callers MUST authorize the thread first
 * (admin: any client; client: only their own id).
 *
 * Bounded on purpose: the newest {@link THREAD_PAGE_SIZE} messages, oldest
 * first for rendering. Pass `before` (an ISO timestamp) to page backwards.
 */
export async function getThreadMessages(
  key: ThreadKey,
  options: { before?: string | null; includeInternal?: boolean } = {},
): Promise<ThreadPage> {
  const before = options.before ? new Date(options.before) : null;
  const rows = await prisma.message.findMany({
    where: {
      clientId: key.clientId,
      projectId: key.projectId,
      // Fail closed: internal notes are opt-in, so a caller that forgets the
      // flag shows a client the public thread, never the notes.
      ...(options.includeInternal ? {} : { visibility: "PUBLIC" as const }),
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
    },
    // Newest first so `take` keeps the recent end of the thread…
    orderBy: { createdAt: "desc" },
    take: THREAD_PAGE_SIZE + 1,
    include: senderSelect,
  });

  const hasMore = rows.length > THREAD_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, THREAD_PAGE_SIZE) : rows;
  // …then flip back to chronological for the UI.
  return { messages: page.reverse().map(toView), hasMore };
}

/**
 * Only what arrived after `since`. The poll uses this so a long thread isn't
 * re-serialised every 20 seconds.
 */
export async function getThreadMessagesSince(
  key: ThreadKey,
  since: string,
  options: { includeInternal?: boolean } = {},
): Promise<MessageView[]> {
  const after = new Date(since);
  if (Number.isNaN(after.getTime())) return [];
  const rows = await prisma.message.findMany({
    where: {
      ...key,
      createdAt: { gt: after },
      ...(options.includeInternal ? {} : { visibility: "PUBLIC" as const }),
    },
    orderBy: { createdAt: "asc" },
    take: THREAD_PAGE_SIZE,
    include: senderSelect,
  });
  return rows.map(toView);
}

/** Project thread (used by the admin + portal project pages). */
export async function getProjectMessages(
  projectId: string,
  options: { includeInternal?: boolean } = {},
): Promise<MessageView[]> {
  const rows = await prisma.message.findMany({
    where: {
      projectId,
      ...(options.includeInternal ? {} : { visibility: "PUBLIC" as const }),
    },
    orderBy: { createdAt: "desc" },
    take: THREAD_PAGE_SIZE,
    include: senderSelect,
  });
  return rows.reverse().map(toView);
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
  /** Who wrote the latest message — whose move it is. */
  lastFrom: "ADMIN" | "CLIENT";
};

/**
 * Admin inbox: one row per thread (client × project|general), newest first,
 * with a count of client messages the admin hasn't read yet.
 *
 * One wave: the latest message per thread (DISTINCT ON over the
 * (clientId, projectId, createdAt) index, with the client and project names
 * joined on) runs beside the unread counts. It used to be a groupBy for the
 * latest timestamps, then the rows behind them: two round trips per load.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  const [latest, unreadGroups] = await Promise.all([
    prisma.$queryRaw<
      {
        clientId: string;
        projectId: string | null;
        senderRole: MessageSenderRole;
        body: unknown;
        bodyText: string | null;
        // A timestamp column, so a Date in UTC; never routed through json.
        createdAt: Date;
        firstName: string;
        lastName: string;
        company: string | null;
        timezone: string | null;
        projectName: string | null;
      }[]
    >`
      SELECT m."clientId", m."projectId", m."senderRole"::text AS "senderRole",
             m.body, m."bodyText", m."createdAt",
             c."firstName", c."lastName", c.company, c.timezone,
             p."projectName"
      FROM (
        SELECT id, "createdAt" FROM (
          -- Two messages can share the exact latest timestamp; one wins.
          SELECT DISTINCT ON ("clientId", "projectId") id, "createdAt"
          FROM messages
          ORDER BY "clientId", "projectId", "createdAt" DESC, id DESC
        ) per_thread
        ORDER BY "createdAt" DESC, id DESC
        LIMIT ${INBOX_PAGE_SIZE}
      ) latest
      JOIN messages m ON m.id = latest.id
      JOIN users c ON c.id = m."clientId"
      LEFT JOIN projects p ON p.id = m."projectId"
      ORDER BY latest."createdAt" DESC, latest.id DESC`,
    prisma.message.groupBy({
      by: ["clientId", "projectId"],
      where: { senderRole: "CLIENT", readByAdminAt: null },
      _count: { _all: true },
    }),
  ]);

  const threadKey = (clientId: string, projectId: string | null) =>
    `${clientId}::${projectId ?? "general"}`;

  const unreadByThread = new Map(
    unreadGroups.map((g) => [threadKey(g.clientId, g.projectId), g._count._all]),
  );

  return latest.map((m) => ({
    clientId: m.clientId,
    clientName: `${m.firstName} ${m.lastName}`.trim() || "Client",
    company: m.company,
    timezone: m.timezone,
    projectId: m.projectId,
    projectName: m.projectName,
    lastMessageAt: m.createdAt.toISOString(),
    preview: `${m.senderRole === "ADMIN" ? "You: " : ""}${
      m.bodyText ? clipPreview(m.bodyText) : richTextPreview(m.body)
    }`,
    unread: unreadByThread.get(threadKey(m.clientId, m.projectId)) ?? 0,
    lastFrom: m.senderRole,
  }));
}

/** Client's thread list: General + one per project, each with unread counts. */
export async function listMyThreads(clientId: string) {
  const [projects, unreadGroups] = await Promise.all([
    prisma.project.findMany({
      where: { clientId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, projectName: true },
    }),
    prisma.message.groupBy({
      by: ["projectId"],
      // Internal notes are team-side and never shown here, so they never
      // count as unread for the client.
      where: { clientId, senderRole: "ADMIN", visibility: "PUBLIC", readByClientAt: null },
      _count: { _all: true },
    }),
  ]);

  const unreadByThread = new Map(
    unreadGroups.map((g) => [g.projectId ?? "general", g._count._all]),
  );

  return {
    generalUnread: unreadByThread.get("general") ?? 0,
    projects: projects.map((p) => ({
      id: p.id,
      projectName: p.projectName,
      unread: unreadByThread.get(p.id) ?? 0,
    })),
  };
}
