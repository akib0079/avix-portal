"use server";

import { after } from "next/server";
import { z } from "zod";
import { Prisma, type NotificationType, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  boardAccess,
  taskAccess,
  cardSelect,
  commentSelect,
  cardHelp,
  toCard,
  toComment,
  listBoardPeople,
  type BoardViewer,
} from "@/lib/dal/project-board";
import { logActivity } from "@/lib/dal/activity";
import { sendEmail } from "@/lib/email/resend";
import BoardActivityEmail from "@/emails/board-activity";
import { appUrl } from "@/lib/app-url";
import { clipPreview } from "@/lib/rich-text";
import { hasRichTextContent } from "@/components/editor/rich-text-viewer";
import {
  ATTACHMENT_URL,
  COLUMN_BY_ID,
  POSITION_STEP,
  boardTaskHref,
  type BoardCard,
  type BoardComment,
} from "@/lib/board";

/**
 * Mutations for the shared project board.
 *
 * None of these call revalidatePath. The board is client state, reconciled by
 * its own poll (/api/projects/[id]/board), and a revalidation in a server
 * action makes Next re-render the whole project page into the action's
 * response — a few hundred milliseconds of server work on every drag, for a
 * page that has nothing on it that a drag changes. Each action hands back the
 * row it wrote instead, so the board can swap its optimistic copy for the
 * real one.
 *
 * Notifications, emails and the activity log run in after(): the response
 * goes out first, and a slow mail provider never slows a drop or a comment.
 */

export type BoardResult<T> = { ok: true; data: T } | { ok: false; error: string };

const STATUS = z.enum(["BACKLOG", "TODO", "IN_PROGRESS", "REVIEW", "DONE"]);
const PRIORITY = z.enum(["HIGH", "MEDIUM", "LOW"]);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date");

function dayToDate(day: string | null | undefined): Date | null | undefined {
  if (day === undefined) return undefined;
  return day === null ? null : new Date(`${day}T00:00:00.000Z`);
}

function displayName(user: { firstName?: string | null; lastName?: string | null; name: string }) {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.name;
}

/** Cards the team created can be moved and discussed by a client, not rewritten. */
function canEdit(viewer: BoardViewer, task: { createdById: string | null }): boolean {
  return viewer.side === "ADMIN" || task.createdById === viewer.user.id;
}

/** The assignee must be on the team or be this project's client; the milestone must be this project's. */
async function checkRefs(
  viewer: BoardViewer,
  refs: { assigneeId?: string | null; milestoneId?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [assignee, milestone] = await Promise.all([
    refs.assigneeId
      ? prisma.user.findFirst({
          where: {
            id: refs.assigneeId,
            status: "ACTIVE",
            OR: [
              { role: { in: ["ADMIN", "STAFF"] } },
              ...(viewer.project.clientId ? [{ id: viewer.project.clientId }] : []),
            ],
          },
          select: { id: true },
        })
      : null,
    refs.milestoneId
      ? prisma.milestone.findFirst({
          where: { id: refs.milestoneId, projectId: viewer.project.id },
          select: { id: true },
        })
      : null,
  ]);
  if (refs.assigneeId && !assignee) return { ok: false, error: "That person can't be assigned here." };
  if (refs.milestoneId && !milestone) return { ok: false, error: "That milestone isn't on this project." };
  return { ok: true };
}

/* ------------------------------------------------------------------------ */
/* Notifications                                                            */
/* ------------------------------------------------------------------------ */

/** A card that already emailed someone stays quiet for this long. */
const QUIET_MINUTES = 30;

type BoardEvent = {
  type: NotificationType;
  /** Bell row. */
  title: string;
  body?: string;
  /** Email. */
  heading: string;
  intro: string;
  quote?: string | null;
  /** quiet = email unless this card already notified them inside the window. */
  email: "always" | "quiet" | "never";
};

/** Team members who hear about a client's card when nobody is named on it. */
async function teamOnPoint(viewer: BoardViewer, assigneeId: string | null): Promise<string[]> {
  if (assigneeId && assigneeId !== viewer.project.clientId) return [assigneeId];
  if (viewer.project.ownerId) return [viewer.project.ownerId];
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

async function notify(
  viewer: BoardViewer,
  task: { id: string; title: string },
  recipientIds: (string | null | undefined)[],
  event: BoardEvent,
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
  const linkFor = (r: { role: Role }) => boardTaskHref(sideOf(r.role), viewer.project.id, task.id);

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
  // Admins are reached at the agency's alert inbox, like every other admin
  // email; staff and clients at their own address. One email per inbox.
  const adminInbox = process.env.ADMIN_NOTIFICATION_EMAIL;
  const sent = new Set<string>();
  for (const r of recipients) {
    if (event.email === "quiet" && quiet.has(r.id)) continue;
    const to = r.role === "ADMIN" ? adminInbox : r.email;
    if (!to || sent.has(to)) continue;
    sent.add(to);
    try {
      await sendEmail({
        to,
        subject: `${event.heading} — ${task.title}`,
        react: (
          <BoardActivityEmail
            recipientFirstName={r.role === "ADMIN" ? "there" : r.firstName || "there"}
            heading={event.heading}
            intro={event.intro}
            projectName={viewer.project.projectName}
            taskTitle={task.title}
            quote={event.quote}
            url={`${appUrl()}${linkFor(r)}`}
          />
        ),
        devHint: `board ${event.type} → ${to}`,
      });
    } catch (err) {
      console.error("[board] email failed:", (err as Error).message);
    }
  }
}

/** Runs once the response is out. Failures are logged, never surfaced. */
function later(work: () => Promise<unknown>) {
  after(async () => {
    try {
      await work();
    } catch (err) {
      console.error("[board] follow-up failed:", (err as Error).message);
    }
  });
}

/* ------------------------------------------------------------------------ */
/* Cards                                                                    */
/* ------------------------------------------------------------------------ */

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1, "Give the task a title").max(200, "Keep the title under 200 characters"),
  description: z.unknown().optional(),
  status: STATUS.default("TODO"),
  priority: PRIORITY.nullable().optional(),
  dueDate: DAY.nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  /** Top of the column (quick add from the header) instead of the bottom. */
  atTop: z.boolean().optional(),
});

export async function createBoardTask(
  input: z.input<typeof createSchema>,
): Promise<BoardResult<{ card: BoardCard }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid task." };
  const d = parsed.data;

  const viewer = await boardAccess(d.projectId);
  if (!viewer) return { ok: false, error: "Project not found." };
  const refs = await checkRefs(viewer, d);
  if (!refs.ok) return refs;

  const edge = await prisma.projectTask.aggregate({
    where: { projectId: viewer.project.id, status: d.status },
    _min: { position: true },
    _max: { position: true },
  });
  const position = d.atTop
    ? (edge._min.position ?? POSITION_STEP) - POSITION_STEP
    : (edge._max.position ?? 0) + POSITION_STEP;

  const description = hasRichTextContent(d.description)
    ? (d.description as Prisma.InputJsonValue)
    : undefined;

  const row = await prisma.projectTask.create({
    data: {
      projectId: viewer.project.id,
      title: d.title,
      description,
      status: d.status,
      position,
      priority: d.priority ?? null,
      dueDate: dayToDate(d.dueDate) ?? null,
      milestoneId: d.milestoneId ?? null,
      assigneeId: d.assigneeId ?? null,
      createdById: viewer.user.id,
      createdByRole: viewer.side,
      completedAt: d.status === "DONE" ? new Date() : null,
    },
    select: cardSelect,
  });

  const actor = displayName(viewer.user);
  const task = { id: row.id, title: row.title };
  later(async () => {
    await logActivity({
      type: "board.created",
      summary: `${actor} added “${row.title}” to ${COLUMN_BY_ID[row.status].label}`,
      actorId: viewer.user.id,
      clientId: viewer.project.clientId,
      projectId: viewer.project.id,
      entity: "project_task",
      entityId: row.id,
      link: boardTaskHref("ADMIN", viewer.project.id, row.id),
    });
    if (viewer.side === "CLIENT") {
      // The client is handing us work: whoever they pinned hears, or whoever
      // owns the project, or every admin.
      const pinned = !!row.assigneeId && row.assigneeId !== viewer.user.id;
      await notify(viewer, task, await teamOnPoint(viewer, row.assigneeId), {
        type: pinned ? "PROJECT_TASK_ASSIGNED" : "PROJECT_TASK_CREATED",
        title: `${actor} added a task: ${row.title}`,
        body: viewer.project.projectName,
        heading: pinned ? "You've been pinned on a task" : "New task from your client",
        intro: `${actor} added a task to the ${viewer.project.projectName} board${pinned ? " and pinned you on it" : ""}.`,
        quote: d.description ? clipPreview(richTextExcerpt(d.description), 280) : null,
        email: "always",
      });
    } else if (row.assigneeId && row.assigneeId !== viewer.user.id) {
      const forClient = row.assigneeId === viewer.project.clientId;
      await notify(viewer, task, [row.assigneeId], {
        type: "PROJECT_TASK_ASSIGNED",
        title: forClient ? `A task for you: ${row.title}` : `${actor} assigned you: ${row.title}`,
        body: viewer.project.projectName,
        heading: forClient ? "There's a task for you" : "You've been assigned a task",
        intro: `${actor} assigned you a task on ${viewer.project.projectName}.`,
        email: forClient ? "always" : "never",
      });
    }
  });

  return { ok: true, data: { card: toCard(row, null) } };
}

/** First few lines of a Tiptap body, for an email quote. */
function richTextExcerpt(doc: unknown): string {
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

const updateSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(200).optional(),
  description: z.unknown().optional(),
  priority: PRIORITY.nullable().optional(),
  dueDate: DAY.nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
});

export async function updateBoardTask(
  taskId: string,
  patch: z.input<typeof updateSchema>,
): Promise<BoardResult<{ card: BoardCard }>> {
  const parsed = updateSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid change." };
  const p = parsed.data;

  const access = await taskAccess(taskId);
  if (!access) return { ok: false, error: "Task not found." };
  const { viewer, task } = access;
  if (!canEdit(viewer, task)) {
    return { ok: false, error: "This card belongs to the team — comment on it instead." };
  }
  const refs = await checkRefs(viewer, p);
  if (!refs.ok) return refs;

  const data: Prisma.ProjectTaskUncheckedUpdateInput = {};
  if (p.title !== undefined) data.title = p.title;
  if ("description" in patch) {
    data.description = hasRichTextContent(p.description)
      ? (p.description as Prisma.InputJsonValue)
      : Prisma.DbNull;
  }
  if (p.priority !== undefined) data.priority = p.priority;
  if (p.dueDate !== undefined) data.dueDate = dayToDate(p.dueDate);
  if (p.milestoneId !== undefined) data.milestoneId = p.milestoneId;
  if (p.assigneeId !== undefined) data.assigneeId = p.assigneeId;

  const [row, help] = await Promise.all([
    prisma.projectTask.update({ where: { id: task.id }, data, select: cardSelect }),
    cardHelp(task.id),
  ]);

  const newAssignee = p.assigneeId !== undefined && p.assigneeId !== task.assigneeId ? p.assigneeId : null;
  if (newAssignee && newAssignee !== viewer.user.id) {
    const actor = displayName(viewer.user);
    const crossSide = viewer.side === "CLIENT" || newAssignee === viewer.project.clientId;
    later(() =>
      notify(viewer, row, [newAssignee], {
        type: "PROJECT_TASK_ASSIGNED",
        title: `${actor} assigned you: ${row.title}`,
        body: viewer.project.projectName,
        heading: viewer.side === "CLIENT" ? "You've been pinned on a task" : "There's a task for you",
        intro: `${actor} assigned you a task on ${viewer.project.projectName}.`,
        email: crossSide ? "always" : "never",
      }),
    );
  }

  return { ok: true, data: { card: toCard(row, help) } };
}

const moveSchema = z.object({
  taskId: z.string().min(1),
  status: STATUS,
  position: z.number(),
});

/**
 * A drop. The board computes the new position (the midpoint of the card's new
 * neighbours) so this writes one row; only when midpoints have worn the gap
 * down to nothing does it renumber the column, and then it hands the new
 * numbers back.
 */
export async function moveBoardTask(
  input: z.input<typeof moveSchema>,
): Promise<BoardResult<{ card: BoardCard; renumbered: { id: string; position: number }[] }>> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid move." };
  const { status, position } = parsed.data;

  const access = await taskAccess(parsed.data.taskId);
  if (!access) return { ok: false, error: "Task not found." };
  const { viewer, task } = access;
  const from = task.status;

  const [row, help] = await Promise.all([
    prisma.projectTask.update({
      where: { id: task.id },
      data: {
        status,
        position,
        completedAt: status === "DONE" ? (task.completedAt ?? new Date()) : null,
      },
      select: cardSelect,
    }),
    cardHelp(task.id),
  ]);

  // Renumber only when two neighbours have collided.
  let renumbered: { id: string; position: number }[] = [];
  const column = await prisma.projectTask.findMany({
    where: { projectId: viewer.project.id, status },
    orderBy: { position: "asc" },
    select: { id: true, position: true },
  });
  const crowded = column.some((c, i) => i > 0 && c.position - column[i - 1]!.position < 1e-6);
  if (crowded) {
    renumbered = column.map((c, i) => ({ id: c.id, position: (i + 1) * POSITION_STEP }));
    await prisma.$transaction(
      renumbered.map((c) =>
        prisma.projectTask.update({ where: { id: c.id }, data: { position: c.position } }),
      ),
    );
  }

  if (from !== status) {
    const actor = displayName(viewer.user);
    const to = COLUMN_BY_ID[status].label;
    later(async () => {
      await logActivity({
        type: "board.moved",
        summary: `${actor} moved “${row.title}” to ${to}`,
        actorId: viewer.user.id,
        clientId: viewer.project.clientId,
        projectId: viewer.project.id,
        entity: "project_task",
        entityId: row.id,
        link: boardTaskHref("ADMIN", viewer.project.id, row.id),
      });
      if (viewer.side === "ADMIN" && status === "REVIEW" && viewer.project.clientId) {
        await notify(viewer, row, [viewer.project.clientId], {
          type: "PROJECT_TASK_REVIEW",
          title: `Ready for your review: ${row.title}`,
          body: viewer.project.projectName,
          heading: "Ready for your review",
          intro: `the team finished a task on ${viewer.project.projectName} and would like your eyes on it. Move it to Done if it's right, or comment if it needs changes.`,
          email: "always",
        });
      }
      // The client's verdict on something we sent for review.
      if (viewer.side === "CLIENT" && from === "REVIEW") {
        const approved = status === "DONE";
        await notify(viewer, row, await teamOnPoint(viewer, row.assigneeId), {
          type: "PROJECT_TASK_REVIEW",
          title: approved ? `${actor} approved: ${row.title}` : `${actor} sent back: ${row.title}`,
          body: `${viewer.project.projectName} · now in ${to}`,
          heading: approved ? "Your client approved a task" : "Your client sent a task back",
          intro: approved
            ? `${actor} moved a task you sent for review to Done.`
            : `${actor} moved a task out of review, back to ${to}.`,
          email: approved ? "never" : "always",
        });
      }
    });
  }

  const card = toCard(row, help);
  if (renumbered.length) {
    card.position = renumbered.find((r) => r.id === card.id)?.position ?? card.position;
  }
  return { ok: true, data: { card, renumbered } };
}

export async function deleteBoardTask(taskId: string): Promise<BoardResult<{ id: string }>> {
  const access = await taskAccess(taskId);
  if (!access) return { ok: false, error: "Task not found." };
  const { viewer, task } = access;
  if (!canEdit(viewer, task)) {
    return { ok: false, error: "Only the team can delete a card they created." };
  }
  await prisma.projectTask.delete({ where: { id: task.id } });
  const actor = displayName(viewer.user);
  later(() =>
    logActivity({
      type: "board.deleted",
      summary: `${actor} deleted “${task.title}” from the board`,
      actorId: viewer.user.id,
      clientId: viewer.project.clientId,
      projectId: viewer.project.id,
    }),
  );
  return { ok: true, data: { id: task.id } };
}

/* ------------------------------------------------------------------------ */
/* Comments and help requests                                               */
/* ------------------------------------------------------------------------ */

const commentSchema = z.object({
  taskId: z.string().min(1),
  body: z.string().max(5000, "Keep it under 5,000 characters"),
  mentionIds: z.array(z.string()).max(20).default([]),
  attachments: z
    .array(z.object({ url: z.string().regex(ATTACHMENT_URL), name: z.string().max(255) }))
    .max(6, "Up to six images per comment")
    .default([]),
  kind: z.enum(["COMMENT", "HELP"]).default("COMMENT"),
});

export async function addBoardComment(
  input: z.input<typeof commentSchema>,
): Promise<BoardResult<{ comment: BoardComment; card: BoardCard }>> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  const d = parsed.data;
  const body = d.body.trim();
  if (!body && d.attachments.length === 0) return { ok: false, error: "Write something first." };

  const access = await taskAccess(d.taskId);
  if (!access) return { ok: false, error: "Task not found." };
  const { viewer, task } = access;

  // Only real people on this board, and only those still named in the text —
  // deleting "@Akib" from the draft un-pins him.
  const people = await listBoardPeople(viewer.project.clientId);
  const mentions = people
    .filter((p) => d.mentionIds.includes(p.id) && body.includes(`@${p.name}`))
    .map((p) => ({ id: p.id, name: p.name }));

  // Attachments must be this user's own uploads.
  if (d.attachments.length) {
    const names = d.attachments.map((a) => a.url.split("/").pop()!);
    const owned = await prisma.imageUpload.count({
      where: { fileName: { in: names }, uploaderId: viewer.user.id },
    });
    if (owned !== new Set(names).size) return { ok: false, error: "One of those images couldn't be attached." };
  }

  const row = await prisma.projectTaskComment.create({
    data: {
      taskId: task.id,
      authorId: viewer.user.id,
      authorRole: viewer.side,
      kind: d.kind,
      body,
      mentions: mentions.length ? mentions : undefined,
      attachments: d.attachments.length ? d.attachments : undefined,
    },
    select: commentSelect,
  });
  const [cardRow, help] = await Promise.all([
    prisma.projectTask.findUniqueOrThrow({ where: { id: task.id }, select: cardSelect }),
    cardHelp(task.id),
  ]);

  const actor = displayName(viewer.user);
  const quote = body ? clipPreview(body, 280) : "(sent an image)";
  later(async () => {
    const mentioned = mentions.map((m) => m.id);
    // The other side of the conversation.
    const otherSide =
      viewer.side === "CLIENT"
        ? await teamOnPoint(viewer, task.assigneeId)
        : viewer.project.clientId
          ? [viewer.project.clientId]
          : [];
    // A teammate on point hears about a colleague's comment too.
    const teammate =
      viewer.side === "ADMIN" && task.assigneeId && task.assigneeId !== viewer.project.clientId
        ? [task.assigneeId]
        : [];

    if (d.kind === "HELP") {
      await logActivity({
        type: "board.help",
        summary: `${actor} asked for help on “${task.title}”`,
        actorId: viewer.user.id,
        clientId: viewer.project.clientId,
        projectId: viewer.project.id,
        entity: "project_task",
        entityId: task.id,
        link: boardTaskHref("ADMIN", viewer.project.id, task.id),
      });
      await notify(viewer, task, [...otherSide, ...mentioned], {
        type: "PROJECT_TASK_HELP",
        title: `${actor} needs help: ${task.title}`,
        body: quote,
        heading: viewer.side === "CLIENT" ? "Your client needs a hand" : "The team needs your input",
        intro: `${actor} asked for help on a task in ${viewer.project.projectName}.`,
        quote,
        email: "always",
      });
      return;
    }

    if (mentioned.length) {
      await notify(viewer, task, mentioned, {
        type: "PROJECT_TASK_MENTION",
        title: `${actor} mentioned you: ${task.title}`,
        body: quote,
        heading: "You were mentioned",
        intro: `${actor} mentioned you on a task in ${viewer.project.projectName}.`,
        quote,
        email: "always",
      });
    }
    const rest = [...otherSide, ...teammate].filter((id) => !mentioned.includes(id));
    await notify(viewer, task, rest, {
      type: "PROJECT_TASK_COMMENT",
      title: `${actor} commented: ${task.title}`,
      body: quote,
      heading: "New comment on a task",
      intro: `${actor} commented on a task in ${viewer.project.projectName}.`,
      quote,
      email: "quiet",
    });
  });

  return { ok: true, data: { comment: toComment(row), card: toCard(cardRow, help) } };
}

async function commentAccess(commentId: string) {
  const comment = await prisma.projectTaskComment.findUnique({
    where: { id: commentId },
    select: { id: true, taskId: true, authorId: true, kind: true, resolvedAt: true },
  });
  if (!comment) return null;
  const access = await taskAccess(comment.taskId);
  return access ? { ...access, comment } : null;
}

/** Either side may close a help request — the asker, or whoever answered it. */
export async function resolveBoardHelp(
  commentId: string,
): Promise<BoardResult<{ comment: BoardComment; card: BoardCard }>> {
  const access = await commentAccess(commentId);
  if (!access) return { ok: false, error: "Comment not found." };
  const { viewer, task, comment } = access;
  if (comment.kind !== "HELP") return { ok: false, error: "That isn't a help request." };

  const row = comment.resolvedAt
    ? await prisma.projectTaskComment.findUniqueOrThrow({ where: { id: comment.id }, select: commentSelect })
    : await prisma.projectTaskComment.update({
        where: { id: comment.id },
        data: { resolvedAt: new Date(), resolvedById: viewer.user.id },
        select: commentSelect,
      });
  const [cardRow, help] = await Promise.all([
    prisma.projectTask.findUniqueOrThrow({ where: { id: task.id }, select: cardSelect }),
    cardHelp(task.id),
  ]);
  return { ok: true, data: { comment: toComment(row), card: toCard(cardRow, help) } };
}

/** Authors delete their own comments; an admin can remove any. */
export async function deleteBoardComment(
  commentId: string,
): Promise<BoardResult<{ id: string; card: BoardCard }>> {
  const access = await commentAccess(commentId);
  if (!access) return { ok: false, error: "Comment not found." };
  const { viewer, task, comment } = access;
  if (comment.authorId !== viewer.user.id && viewer.user.role !== "ADMIN") {
    return { ok: false, error: "You can only delete your own comments." };
  }
  await prisma.projectTaskComment.delete({ where: { id: comment.id } });
  const [cardRow, help] = await Promise.all([
    prisma.projectTask.findUniqueOrThrow({ where: { id: task.id }, select: cardSelect }),
    cardHelp(task.id),
  ]);
  return { ok: true, data: { id: comment.id, card: toCard(cardRow, help) } };
}
