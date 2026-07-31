import "server-only";
import { prisma } from "@/lib/prisma";
import type { JSONContent } from "@tiptap/react";
import type { MessageSenderRole, MessageVisibility, Prisma, Role } from "@prisma/client";
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
};

/**
 * Admin inbox: one row per thread (client × project|general), newest first,
 * with a count of client messages the admin hasn't read yet.
 *
 * Three bounded queries rather than one unbounded scan: group to find the
 * latest activity per thread, fetch only those latest rows, then group the
 * unread counts. The old version pulled every message in the database and
 * folded it in JS.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  const groups = await prisma.message.groupBy({
    by: ["clientId", "projectId"],
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: INBOX_PAGE_SIZE,
  });
  if (groups.length === 0) return [];

  // One OR-clause per thread, each hitting (clientId, projectId, createdAt).
  const latestFilters: Prisma.MessageWhereInput[] = groups.flatMap((g) =>
    g._max.createdAt
      ? [{ clientId: g.clientId, projectId: g.projectId, createdAt: g._max.createdAt }]
      : [],
  );

  const [latest, unreadGroups] = await Promise.all([
    prisma.message.findMany({
      where: { OR: latestFilters },
      select: {
        clientId: true,
        projectId: true,
        senderRole: true,
        body: true,
        bodyText: true,
        createdAt: true,
        client: {
          select: { id: true, firstName: true, lastName: true, company: true, timezone: true },
        },
        project: { select: { id: true, projectName: true } },
      },
    }),
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

  const summaries = new Map<string, ConversationSummary>();
  for (const m of latest) {
    const key = threadKey(m.clientId, m.projectId);
    // Two messages can share the exact latest timestamp; first one wins.
    if (summaries.has(key)) continue;
    summaries.set(key, {
      clientId: m.clientId,
      clientName: `${m.client.firstName} ${m.client.lastName}`.trim() || "Client",
      company: m.client.company,
      timezone: m.client.timezone,
      projectId: m.projectId,
      projectName: m.project?.projectName ?? null,
      lastMessageAt: m.createdAt.toISOString(),
      preview: `${m.senderRole === "ADMIN" ? "You: " : ""}${
        m.bodyText ? clipPreview(m.bodyText) : richTextPreview(m.body)
      }`,
      unread: unreadByThread.get(key) ?? 0,
    });
  }

  return [...summaries.values()].sort(
    (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt),
  );
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
      where: { clientId, senderRole: "ADMIN", readByClientAt: null },
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
