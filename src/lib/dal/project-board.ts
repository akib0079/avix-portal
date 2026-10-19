import "server-only";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/dal/session";
import type { SessionUser } from "@/lib/auth";
import type { JSONContent } from "@tiptap/react";
import type { Prisma } from "@prisma/client";
import { hasRichTextContent } from "@/components/editor/rich-text-viewer";
import type {
  BoardAttachment,
  BoardCard,
  BoardComment,
  BoardData,
  BoardMention,
  BoardPerson,
  BoardSide,
  BoardTaskDetail,
} from "@/lib/board";

/**
 * Reads for the shared project board.
 *
 * Access is the same rule everywhere: the team (admin or staff) sees every
 * project's board; a client sees only the boards of projects they own. The
 * check always goes through {@link boardAccess} / {@link taskAccess}, which
 * read the session themselves — callers never pass a user id in.
 */

export type BoardViewer = {
  user: SessionUser;
  side: BoardSide;
  project: { id: string; projectName: string; clientId: string | null; ownerId: string | null };
};

function sideOf(user: SessionUser): BoardSide | null {
  if (user.role === "ADMIN" || user.role === "STAFF") return "ADMIN";
  if (user.role === "CLIENT") return "CLIENT";
  return null;
}

const projectSelect = { id: true, projectName: true, clientId: true, ownerId: true } as const;

/** The signed-in viewer's access to a project's board, or null for none. */
export async function boardAccess(projectId: string): Promise<BoardViewer | null> {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") return null;
  const side = sideOf(session.user);
  if (!side) return null;
  const project = await prisma.project.findFirst({
    where: side === "CLIENT" ? { id: projectId, clientId: session.user.id } : { id: projectId },
    select: projectSelect,
  });
  return project ? { user: session.user, side, project } : null;
}

/** Same rule, reached through a card. Returns the card's raw row too. */
export async function taskAccess(taskId: string) {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") return null;
  const side = sideOf(session.user);
  if (!side) return null;
  const task = await prisma.projectTask.findFirst({
    where:
      side === "CLIENT"
        ? { id: taskId, project: { clientId: session.user.id } }
        : { id: taskId },
    include: { project: { select: projectSelect } },
  });
  if (!task) return null;
  const viewer: BoardViewer = { user: session.user, side, project: task.project };
  return { viewer, task };
}

export const cardSelect = {
  id: true,
  title: true,
  status: true,
  position: true,
  priority: true,
  dueDate: true,
  milestoneId: true,
  assigneeId: true,
  createdById: true,
  createdByRole: true,
  description: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  // No createdBy join: Prisma runs a relation as a second, sequential query,
  // and the board already holds everyone's name (BoardData.people).
  _count: { select: { comments: true } },
} satisfies Prisma.ProjectTaskSelect;

type CardRow = Prisma.ProjectTaskGetPayload<{ select: typeof cardSelect }>;

function personName(u: { firstName: string; lastName: string; name: string }): string {
  return `${u.firstName} ${u.lastName}`.trim() || u.name;
}

export function toCard(row: CardRow, helpFrom: BoardSide | null): BoardCard {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    position: row.position,
    priority: row.priority,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    milestoneId: row.milestoneId,
    assigneeId: row.assigneeId,
    createdById: row.createdById,
    createdByRole: row.createdByRole,
    hasDescription: hasRichTextContent(row.description),
    commentCount: row._count.comments,
    helpFrom,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Who is waiting on help, per card. When both sides have asked, the client's
 * request wins the badge — the team owes the answer first.
 */
async function openHelpByTask(where: Prisma.ProjectTaskCommentWhereInput) {
  const groups = await prisma.projectTaskComment.groupBy({
    by: ["taskId", "authorRole"],
    where: { ...where, kind: "HELP", resolvedAt: null },
    _count: { _all: true },
  });
  const map = new Map<string, BoardSide>();
  for (const g of groups) {
    if (g.authorRole === "CLIENT" || !map.has(g.taskId)) map.set(g.taskId, g.authorRole);
  }
  return map;
}

/** Who is waiting on help on one card. */
export async function cardHelp(taskId: string): Promise<BoardSide | null> {
  return (await openHelpByTask({ taskId })).get(taskId) ?? null;
}

/** The single card, as the board draws it — after a mutation. */
export async function loadCard(taskId: string): Promise<BoardCard | null> {
  const [row, help] = await Promise.all([
    prisma.projectTask.findUnique({ where: { id: taskId }, select: cardSelect }),
    openHelpByTask({ taskId }),
  ]);
  return row ? toCard(row, help.get(taskId) ?? null) : null;
}

/**
 * Everyone a card can be assigned to or a comment can mention: the active team,
 * plus this project's client. Names only — no emails reach a client payload.
 */
export async function listBoardPeople(clientId: string | null): Promise<BoardPerson[]> {
  const rows = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { role: { in: ["ADMIN", "STAFF"] } },
        ...(clientId ? [{ id: clientId }] : []),
      ],
    },
    orderBy: [{ role: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, name: true, role: true },
  });
  return rows.map((u) => ({ id: u.id, name: personName(u), role: u.role }));
}

/**
 * A project's cards, each with who (if anyone) is waiting on help. Bounded: a
 * board past a few hundred cards has stopped being a board, and the cap keeps
 * a runaway one from shipping megabytes on every poll.
 *
 * Takes a bare id and does NO access check, so a page can start it in the
 * same wave as its own ownership check instead of after it — a database round
 * trip off every project page. Callers must authorize before they render or
 * return the result: the pages through getProject/getMyProject, the poll
 * through boardAccess.
 */
export async function getBoardCards(projectId: string): Promise<BoardCard[]> {
  const [rows, help] = await Promise.all([
    prisma.projectTask.findMany({
      where: { projectId },
      orderBy: [{ status: "asc" }, { position: "asc" }],
      take: 500,
      select: cardSelect,
    }),
    openHelpByTask({ task: { projectId } }),
  ]);
  return rows.map((r) => toCard(r, help.get(r.id) ?? null));
}

/**
 * The team plus this project's client — found through the project itself, so
 * the client's id isn't needed up front. Same no-check rule as above.
 */
export async function getBoardPeople(projectId: string): Promise<BoardPerson[]> {
  const people = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ role: { in: ["ADMIN", "STAFF"] } }, { projects: { some: { id: projectId } } }],
    },
    orderBy: [{ role: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, name: true, role: true },
  });
  return people.map((u) => ({ id: u.id, name: personName(u), role: u.role }));
}

/** Everything the board draws, for its poll. Same no-check rule as above. */
export async function getBoard(projectId: string): Promise<BoardData> {
  const [cards, people, milestones] = await Promise.all([
    getBoardCards(projectId),
    getBoardPeople(projectId),
    prisma.milestone.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      select: { id: true, title: true },
    }),
  ]);
  return { cards, people, milestones };
}

export const commentSelect = {
  id: true,
  authorId: true,
  authorRole: true,
  kind: true,
  body: true,
  mentions: true,
  attachments: true,
  resolvedAt: true,
  createdAt: true,
  author: { select: { firstName: true, lastName: true, name: true, role: true } },
} satisfies Prisma.ProjectTaskCommentSelect;

type CommentRow = Prisma.ProjectTaskCommentGetPayload<{ select: typeof commentSelect }>;

function jsonList<T>(value: unknown, pick: (v: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const picked = pick(v as Record<string, unknown>);
    return picked ? [picked] : [];
  });
}

export function toComment(row: CommentRow): BoardComment {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.author
      ? personName(row.author)
      : row.authorRole === "ADMIN"
        ? "Avix Digital"
        : "Client",
    authorRole: row.authorRole,
    authorIsStaff: row.author?.role === "STAFF",
    kind: row.kind,
    body: row.body,
    mentions: jsonList<BoardMention>(row.mentions, (v) =>
      typeof v.id === "string" && typeof v.name === "string" ? { id: v.id, name: v.name } : null,
    ),
    attachments: jsonList<BoardAttachment>(row.attachments, (v) =>
      typeof v.url === "string" ? { url: v.url, name: typeof v.name === "string" ? v.name : "image" } : null,
    ),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadComment(id: string): Promise<BoardComment | null> {
  const row = await prisma.projectTaskComment.findUnique({ where: { id }, select: commentSelect });
  return row ? toComment(row) : null;
}

/** A card opened in the drawer: the card, its description and its thread. */
export async function getBoardTaskDetail(taskId: string): Promise<BoardTaskDetail | null> {
  const [row, comments, help] = await Promise.all([
    prisma.projectTask.findUnique({ where: { id: taskId }, select: cardSelect }),
    prisma.projectTaskComment.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
      // A card's thread, not an archive: the newest few hundred.
      take: 300,
      select: commentSelect,
    }),
    openHelpByTask({ taskId }),
  ]);
  if (!row) return null;
  return {
    card: toCard(row, help.get(taskId) ?? null),
    description: (row.description as JSONContent | null) ?? null,
    comments: comments.map(toComment),
  };
}

/**
 * Open help requests across every project, for the admin's attention lists.
 * Only the client's asks — the team's own questions are waiting on someone else.
 */
export async function countOpenClientHelp(projectId?: string): Promise<number> {
  return prisma.projectTaskComment.count({
    where: {
      kind: "HELP",
      resolvedAt: null,
      authorRole: "CLIENT",
      ...(projectId ? { task: { projectId } } : {}),
    },
  });
}
