import "server-only";
import { after } from "next/server";
import type { NotificationType, Prisma, ProjectTaskStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/resend";
import BoardActivityEmail from "@/emails/board-activity";
import TaskRequestSubmittedEmail from "@/emails/task-request-submitted";
import { appUrl } from "@/lib/app-url";
import { logActivity } from "@/lib/dal/activity";
import { COLUMN_BY_ID, parentProblem, positionBetween, workItemHref } from "@/lib/board";
import { stageWrite } from "@/lib/work-stage";
import {
  itemSelect,
  type AccessedItem,
  type BoardViewer,
  type ItemRow,
} from "@/lib/dal/project-board";

/**
 * Server-side pieces the work-item actions share: the board and list writes
 * (actions/project-board.tsx), client requests (actions/task-requests.tsx),
 * the milestone list (actions/milestones.ts) and the portal's approve / send
 * back (actions/portal.ts). They live outside those "use server" files on
 * purpose — anything a "use server" file exports becomes a callable endpoint.
 */

export type WorkResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Runs once the response is out. Failures are logged, never surfaced. */
export function later(work: () => Promise<unknown>) {
  after(async () => {
    try {
      await work();
    } catch (err) {
      console.error("[work] follow-up failed:", (err as Error).message);
    }
  });
}

export function displayName(user: { firstName?: string | null; lastName?: string | null; name: string }) {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.name;
}

/** An empty Tiptap doc, for a request that came with a title only. */
export const EMPTY_DOC = { type: "doc", content: [] } as const;

/** The pricing columns for a validated pricing choice; fields of other types are cleared. */
export function pricingColumns(p: {
  pricingType: "NONE" | "HOURLY" | "FIXED";
  hourlyRate?: number | null;
  estimatedHours?: number | null;
  fixedPrice?: number | null;
}) {
  return {
    pricingType: p.pricingType,
    hourlyRate: p.pricingType === "HOURLY" ? (p.hourlyRate ?? null) : null,
    estimatedHours: p.pricingType === "HOURLY" ? (p.estimatedHours ?? null) : null,
    fixedPrice: p.pricingType === "FIXED" ? (p.fixedPrice ?? null) : null,
  };
}

/** What STAFF and clients write: no price at all. */
export const NO_PRICING = {
  pricingType: "NONE" as const,
  hourlyRate: null,
  estimatedHours: null,
  fixedPrice: null,
};

/* ------------------------------------------------------------------------ */
/* References and placement                                                 */
/* ------------------------------------------------------------------------ */

/**
 * The assignee must be on the team — or, when the team assigns, this
 * project's client ("there's a task for you"). The phase must be a valid
 * parent for this item (see parentProblem in board.ts).
 */
export async function checkWorkRefs(
  viewer: BoardViewer,
  refs: { assigneeId?: string | null; parentId?: string | null },
  item?: { id: string; childCount: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientId = viewer.side === "ADMIN" ? viewer.project.clientId : null;
  const [assignee, parent] = await Promise.all([
    refs.assigneeId
      ? prisma.user.findFirst({
          where: {
            id: refs.assigneeId,
            status: "ACTIVE",
            OR: [{ role: { in: ["ADMIN", "STAFF"] } }, ...(clientId ? [{ id: clientId }] : [])],
          },
          select: { id: true },
        })
      : null,
    refs.parentId
      ? prisma.milestone.findUnique({
          where: { id: refs.parentId },
          select: { id: true, projectId: true, parentId: true, stage: true, archivedAt: true },
        })
      : null,
  ]);
  if (refs.assigneeId && !assignee) return { ok: false, error: "That person can't be assigned here." };
  if (refs.parentId) {
    const problem = parentProblem(item ?? { childCount: 0 }, parent, viewer.project.id);
    if (problem) return { ok: false, error: problem };
  }
  return { ok: true };
}

/**
 * Where a new item goes: the end of the project's plan, and the end (or the
 * top) of its board column. Two aggregates in one wave.
 */
export async function placeNew(
  projectId: string,
  stage: ProjectTaskStatus,
  atTop = false,
): Promise<{ position: number; boardPosition: number }> {
  const [plan, column] = await Promise.all([
    prisma.milestone.aggregate({ where: { projectId }, _max: { position: true } }),
    prisma.milestone.aggregate({
      where: { projectId, stage, archivedAt: null, boardPosition: { gt: 0 } },
      _min: { boardPosition: true },
      _max: { boardPosition: true },
    }),
  ]);
  return {
    position: (plan._max.position ?? -1) + 1,
    boardPosition: atTop
      ? positionBetween(null, column._min.boardPosition)
      : positionBetween(column._max.boardPosition, null),
  };
}

/** The end of a board column, for an item moving there without a drop position. */
export async function endOfColumn(projectId: string, stage: ProjectTaskStatus): Promise<number> {
  const column = await prisma.milestone.aggregate({
    where: { projectId, stage, archivedAt: null },
    _max: { boardPosition: true },
  });
  return positionBetween(column._max.boardPosition, null);
}

/**
 * Whether an item carries records someone may need later — logged hours,
 * invoice lines, a thread, or the client's request — and so must be archived
 * rather than deleted. (Deleting a milestone used to cascade its time entries
 * away with it.)
 */
export async function hasHistory(item: { id: string; sourceTaskRequestId: string | null }) {
  if (item.sourceTaskRequestId) return true;
  const row = await prisma.milestone.findUnique({
    where: { id: item.id },
    select: { _count: { select: { timeEntries: true, invoiceItems: true, comments: true } } },
  });
  return (
    !row ||
    row._count.timeEntries > 0 ||
    row._count.invoiceItems > 0 ||
    row._count.comments > 0
  );
}

/**
 * Archive an item, and the work under it in the same moment (restoring the
 * item brings back whatever was archived with it). A client's request still
 * waiting under it is lifted to the top level instead: requests are
 * declined, never archived, so "Requested" keeps meaning "waiting for us".
 */
export async function archiveTree(itemId: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.milestone.update({ where: { id: itemId }, data: { archivedAt: now } }),
    prisma.milestone.updateMany({
      where: { parentId: itemId, archivedAt: null, stage: { not: "REQUESTED" } },
      data: { archivedAt: now },
    }),
    prisma.milestone.updateMany({
      where: { parentId: itemId, archivedAt: null, stage: "REQUESTED" },
      data: { parentId: null },
    }),
  ]);
}

/* ------------------------------------------------------------------------ */
/* Client additions                                                         */
/* ------------------------------------------------------------------------ */

/** Where a client's addition lands: Requested, or To do on an auto-accept project. */
export function clientAdditionStage(viewer: BoardViewer): ProjectTaskStatus {
  return viewer.project.autoAcceptClientTasks ? "TODO" : "REQUESTED";
}

/**
 * Everything a client adds — from the board, the "Request a task" form or a
 * chat message — becomes a work item and its request in one write. The item
 * waits in Requested until the team accepts or declines it; the TaskRequest
 * is the decision ledger (the client's wording, our note, when we decided).
 * A live item is Requested exactly while its request is PENDING.
 *
 * On a project with autoAcceptClientTasks the item skips the queue: it lands
 * in To do, unpriced, and its request is recorded as already approved.
 *
 * Written from the request's side so the nested create can use plain ids.
 */
export async function createClientAddition(
  viewer: BoardViewer,
  d: {
    title: string;
    description: Prisma.InputJsonValue | null;
    priority?: "HIGH" | "MEDIUM" | "LOW" | null;
    dueDate?: Date | null;
    parentId?: string | null;
    assigneeId?: string | null;
  },
  place: { position: number; boardPosition: number },
): Promise<{ row: ItemRow; accepted: boolean }> {
  const accepted = viewer.project.autoAcceptClientTasks;
  const stage = clientAdditionStage(viewer);
  const now = new Date();
  const request = await prisma.taskRequest.create({
    data: {
      title: d.title,
      description: d.description ?? EMPTY_DOC,
      projectId: viewer.project.id,
      clientId: viewer.user.id,
      status: accepted ? "APPROVED" : "PENDING",
      resolvedAt: accepted ? now : null,
      milestone: {
        create: {
          projectId: viewer.project.id,
          title: d.title,
          description: d.description ?? undefined,
          ...stageWrite(stage, null, now),
          position: place.position,
          boardPosition: place.boardPosition,
          priority: d.priority ?? null,
          dueDate: d.dueDate ?? null,
          parentId: d.parentId ?? null,
          assigneeId: d.assigneeId ?? null,
          pricingType: "NONE",
          createdById: viewer.user.id,
          createdByRole: "CLIENT",
        },
      },
    },
    select: { milestone: { select: itemSelect } },
  });
  if (!request.milestone) throw new Error("request created without its work item");
  return { row: request.milestone, accepted };
}

/**
 * Who hears about a client's addition, and how. Admins decide on requests
 * (pricing is theirs), so they always get the bell; whoever the client pinned
 * and the project's owner hear too. An auto-accepted addition is ordinary
 * work for the team on point.
 */
export async function announceClientAddition(
  viewer: BoardViewer,
  item: { id: string; title: string; assigneeId: string | null },
  accepted: boolean,
  quote: string | null,
) {
  const actor = displayName(viewer.user);
  const link = workItemHref(viewer.project.id, item.id, "ADMIN");
  await Promise.all([
    logActivity({
      type: accepted ? "work.created" : "work.requested",
      summary: accepted
        ? `${actor} added “${item.title}” to To do`
        : `${actor} requested “${item.title}”`,
      actorId: viewer.user.id,
      clientId: viewer.project.clientId,
      projectId: viewer.project.id,
      entity: "milestone",
      entityId: item.id,
      link,
    }),
    accepted
      ? announceAcceptedAddition(viewer, item, actor, quote)
      : announceRequest(viewer, item, actor, quote, link),
  ]);
}

/** An auto-accepted addition is ordinary work for whoever is on point. */
async function announceAcceptedAddition(
  viewer: BoardViewer,
  item: { id: string; title: string; assigneeId: string | null },
  actor: string,
  quote: string | null,
) {
  const pinned = item.assigneeId && item.assigneeId !== viewer.user.id;
  await notifyWork(viewer, item, await teamOnPoint(viewer, item.assigneeId), {
    type: pinned ? "PROJECT_TASK_ASSIGNED" : "PROJECT_TASK_CREATED",
    title: `${actor} added a task: ${item.title}`,
    body: viewer.project.projectName,
    heading: pinned ? "You've been pinned on a task" : "New task from your client",
    intro: `${actor} added a task to ${viewer.project.projectName}${pinned ? " and pinned you on it" : ""}.`,
    quote,
    email: "always",
  });
}

/** A request waits for a decision, so the admins hear, and anyone on point. */
async function announceRequest(
  viewer: BoardViewer,
  item: { id: string; title: string; assigneeId: string | null },
  actor: string,
  quote: string | null,
  link: string,
) {
  const pinned = item.assigneeId && item.assigneeId !== viewer.user.id ? item.assigneeId : null;
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  // The admin inbox gets the request's own email below; the bells, and an
  // email for a staff member on point, come from here.
  await notifyWork(
    viewer,
    item,
    [...admins.map((a) => a.id), viewer.project.ownerId, pinned],
    {
      type: "TASK_REQUEST_SUBMITTED",
      title: `New request from ${actor}: ${item.title}`,
      body: viewer.project.projectName,
      heading: pinned ? "You've been pinned on a request" : "New request from your client",
      intro: `${actor} asked for something new on ${viewer.project.projectName}. Accept it (and price it) or decline it with a note.`,
      quote,
      email: "always",
    },
    { adminInbox: false },
  );
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (adminEmail) {
    await sendEmail({
      to: adminEmail,
      subject: `New request: ${item.title}`,
      react: (
        <TaskRequestSubmittedEmail
          clientName={actor}
          projectName={viewer.project.projectName}
          title={item.title}
          adminUrl={`${appUrl()}${link}`}
        />
      ),
      devHint: `task request "${item.title}" → ${adminEmail}`,
    });
  }
}

/* ------------------------------------------------------------------------ */
/* The client's verdict on work in review                                   */
/* ------------------------------------------------------------------------ */

/**
 * The write for a client's approval: Done, approved now, at `boardPosition`
 * (the drop) or the end of the Done column. Shared by the board's drop and
 * the portal's Approve button, so both mean exactly the same thing.
 */
export async function writeApproval(item: AccessedItem, boardPosition?: number): Promise<ItemRow> {
  const now = new Date();
  const position = boardPosition ?? (await endOfColumn(item.projectId, "DONE"));
  return prisma.milestone.update({
    where: { id: item.id },
    data: {
      ...stageWrite("DONE", item, now),
      clientApprovedAt: item.clientApprovedAt ?? now,
      boardPosition: position,
    },
    select: itemSelect,
  });
}

/** Who hears that the client approved: the admins (it may now be billable) and whoever did it. */
export async function announceApproval(viewer: BoardViewer, item: { id: string; title: string; assigneeId: string | null }) {
  const actor = displayName(viewer.user);
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  await Promise.all([
    logActivity({
      type: "milestone.approved",
      summary: `${actor} approved “${item.title}”`,
      actorId: viewer.user.id,
      clientId: viewer.project.clientId,
      projectId: viewer.project.id,
      entity: "milestone",
      entityId: item.id,
      link: workItemHref(viewer.project.id, item.id, "ADMIN"),
    }),
    notifyWork(viewer, item, [...admins.map((a) => a.id), item.assigneeId, viewer.project.ownerId], {
      type: "MILESTONE_APPROVED",
      title: `${actor} approved: ${item.title}`,
      body: viewer.project.projectName,
      heading: "Your client approved a task",
      intro: `${actor} approved work you sent for review.`,
      // Routine good news: the bell carries it.
      email: "never",
    }),
  ]);
}

/**
 * The write for a client sending work back: the stage change and the
 * comment that says why, in one transaction — a send-back without its reason
 * is useless to the team.
 */
export async function writeSendBack(
  viewer: BoardViewer,
  item: AccessedItem,
  to: "TODO" | "IN_PROGRESS",
  comment: string,
  boardPosition?: number,
): Promise<ItemRow> {
  const position = boardPosition ?? (await endOfColumn(item.projectId, to));
  // The comment first, so the row read back counts it.
  const [, row] = await prisma.$transaction([
    prisma.milestoneComment.create({
      data: {
        milestoneId: item.id,
        authorId: viewer.user.id,
        authorRole: "CLIENT",
        kind: "COMMENT",
        body: comment,
      },
      select: { id: true },
    }),
    prisma.milestone.update({
      where: { id: item.id },
      data: { ...stageWrite(to, item), clientApprovedAt: null, boardPosition: position },
      select: itemSelect,
    }),
  ]);
  return row;
}

export async function announceSendBack(
  viewer: BoardViewer,
  item: { id: string; title: string; assigneeId: string | null },
  to: ProjectTaskStatus,
  comment: string,
) {
  const actor = displayName(viewer.user);
  const column = COLUMN_BY_ID[to].label;
  await Promise.all([
    logActivity({
      type: "work.moved",
      summary: `${actor} sent “${item.title}” back to ${column}`,
      actorId: viewer.user.id,
      clientId: viewer.project.clientId,
      projectId: viewer.project.id,
      entity: "milestone",
      entityId: item.id,
      link: workItemHref(viewer.project.id, item.id, "ADMIN"),
    }),
    notifyWork(viewer, item, await teamOnPoint(viewer, item.assigneeId), {
      type: "PROJECT_TASK_REVIEW",
      title: `${actor} sent back: ${item.title}`,
      body: comment,
      heading: "Your client sent a task back",
      intro: `${actor} reviewed a task and sent it back to ${column}.`,
      quote: comment,
      email: "always",
    }),
  ]);
}

/* ------------------------------------------------------------------------ */
/* Notifications                                                            */
/* ------------------------------------------------------------------------ */

/** An item that already emailed someone stays quiet for this long. */
const QUIET_MINUTES = 30;

export type WorkEvent = {
  type: NotificationType;
  /** Bell row. */
  title: string;
  body?: string;
  /** Email. */
  heading: string;
  intro: string;
  quote?: string | null;
  /** quiet = email unless this item already notified them inside the window. */
  email: "always" | "quiet" | "never";
};

/** Team members who hear about a client's move when nobody is named on the item. */
export async function teamOnPoint(viewer: BoardViewer, assigneeId: string | null): Promise<string[]> {
  if (assigneeId && assigneeId !== viewer.project.clientId) return [assigneeId];
  if (viewer.project.ownerId) return [viewer.project.ownerId];
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

/**
 * A bell for each recipient (never the actor), and an email where the event
 * warrants one. Admins are reached at the agency's alert inbox, like every
 * other admin email (unless the caller sends its own, `adminInbox: false`);
 * staff and clients at their own address. One email per inbox. Each person's
 * link is for their side of the app.
 */
export async function notifyWork(
  viewer: BoardViewer,
  item: { id: string; title: string },
  recipientIds: (string | null | undefined)[],
  event: WorkEvent,
  opts: { adminInbox?: boolean } = {},
) {
  const ids = [...new Set(recipientIds.filter((id): id is string => !!id))].filter(
    (id) => id !== viewer.user.id,
  );
  if (ids.length === 0) return;
  const recipients = await prisma.user.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    select: { id: true, role: true, email: true, firstName: true },
  });
  if (recipients.length === 0) return;

  const sideOf = (role: Role) => (role === "CLIENT" ? "CLIENT" : "ADMIN");
  const linkFor = (r: { role: Role }) => workItemHref(viewer.project.id, item.id, sideOf(r.role));

  // Asked BEFORE writing this event's own rows, or every check finds them.
  let quiet = new Set<string>();
  if (event.email === "quiet") {
    const recent = await prisma.notification.findMany({
      where: {
        userId: { in: recipients.map((r) => r.id) },
        link: { in: [...new Set(recipients.map(linkFor))] },
        createdAt: { gte: new Date(Date.now() - QUIET_MINUTES * 60_000) },
      },
      select: { userId: true },
    });
    quiet = new Set(recent.map((r) => r.userId));
  }

  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      userId: r.id,
      type: event.type,
      title: event.title,
      body: event.body ?? null,
      link: linkFor(r),
    })),
  });

  if (event.email === "never") return;
  const adminInbox = opts.adminInbox === false ? undefined : process.env.ADMIN_NOTIFICATION_EMAIL;
  const sent = new Set<string>();
  for (const r of recipients) {
    if (event.email === "quiet" && quiet.has(r.id)) continue;
    const to = r.role === "ADMIN" ? adminInbox : r.email;
    if (!to || sent.has(to)) continue;
    sent.add(to);
    try {
      await sendEmail({
        to,
        subject: `${event.heading} — ${item.title}`,
        react: (
          <BoardActivityEmail
            recipientFirstName={r.role === "ADMIN" ? "there" : r.firstName || "there"}
            heading={event.heading}
            intro={event.intro}
            projectName={viewer.project.projectName}
            taskTitle={item.title}
            quote={event.quote}
            url={`${appUrl()}${linkFor(r)}`}
          />
        ),
        devHint: `work ${event.type} → ${to}`,
      });
    } catch (err) {
      console.error("[work] email failed:", (err as Error).message);
    }
  }
}

/** First few lines of a Tiptap body, for an email quote. */
export function richTextExcerpt(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object" || parts.join(" ").length > 400) return;
    const n = node as { text?: string; content?: unknown[] };
    if (typeof n.text === "string") parts.push(n.text);
    n.content?.forEach(walk);
  };
  walk(doc);
  return parts.join(" ").replace(/\s+/g, " ");
}
