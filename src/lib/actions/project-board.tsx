"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  boardAccess,
  itemAccess,
  itemSelect,
  itemExtras,
  emptyExtras,
  toWorkItem,
  commentSelect,
  toComment,
  listBoardPeople,
  type ItemRow,
} from "@/lib/dal/project-board";
import { logActivity } from "@/lib/dal/activity";
import { clipPreview } from "@/lib/rich-text";
import { hasRichTextContent } from "@/components/editor/rich-text-viewer";
import {
  ATTACHMENT_URL,
  COLUMN_BY_ID,
  approvalAfterMove,
  canMoveWorkItem,
  parseDay,
  placeInColumn,
  workItemHref,
  type BoardComment,
  type WorkItem,
} from "@/lib/board";
import { stageWrite } from "@/lib/work-stage";
import { approvalPricingSchema } from "@/lib/validation/task-request";
import {
  EMPTY_DOC,
  NO_PRICING,
  announceApproval,
  announceClientAddition,
  announceSendBack,
  archiveTree,
  checkWorkRefs,
  hasHistory,
  clientAdditionStage,
  createClientAddition,
  displayName,
  later,
  notifyWork,
  placeNew,
  pricingColumns,
  richTextExcerpt,
  teamOnPoint,
  writeApproval,
  writeSendBack,
} from "@/lib/work-items";

/**
 * Writes on project work — the board and the list share them. Every piece of
 * work is a Milestone row (v49); nothing here touches the frozen v48 board
 * tables.
 *
 * Who may do what:
 *  - the team creates and edits anything (pricing is ADMIN-only: STAFF are
 *    money-blind), moves anything except into or out of Requested (accepting
 *    and declining are decisions, in actions/task-requests.tsx), archives,
 *    restores and deletes;
 *  - a client adds work, which waits in Requested with a paired TaskRequest;
 *    edits or withdraws their own requests until they're decided; approves
 *    work in review or sends it back with a reason; and comments anywhere.
 * canMoveWorkItem (src/lib/board.ts) is the one rule for moves.
 *
 * The drag-and-drop writes (create, edit, move, comments) call no
 * revalidatePath: the board is client state reconciled by its own poll, and a
 * revalidation makes Next re-render the whole project page into the action's
 * response — a few hundred milliseconds on every drag. Each hands back the
 * row it wrote instead. The rarer structural writes (archive, restore,
 * delete, withdraw) do revalidate, so the server-rendered list and header
 * catch up.
 *
 * Notifications, emails and the activity log run in after(): the response
 * goes out first, and a slow mail provider never slows a drop or a comment.
 */

export type BoardResult<T> = { ok: true; data: T } | { ok: false; error: string };

const STAGE = z.enum(["REQUESTED", "BACKLOG", "TODO", "IN_PROGRESS", "REVIEW", "DONE"]);
const PRIORITY = z.enum(["HIGH", "MEDIUM", "LOW"]);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date");
const TITLE = z
  .string()
  .trim()
  .min(1, "Give it a title")
  .max(200, "Keep the title under 200 characters");

const NOT_FOUND = { ok: false as const, error: "That item isn't on this project any more." };
const ARCHIVED = { ok: false as const, error: "This item is archived — restore it first." };

function richOrNull(doc: unknown): Prisma.InputJsonValue | null {
  return hasRichTextContent(doc) ? (doc as Prisma.InputJsonValue) : null;
}

function revalidateProject(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/portal/projects/${projectId}`);
}

/* ------------------------------------------------------------------------ */
/* Creating and editing                                                     */
/* ------------------------------------------------------------------------ */

const createSchema = z.object({
  projectId: z.string().min(1),
  title: TITLE,
  description: z.unknown().optional(),
  /** The team's choice. A client's addition always lands in Requested. */
  stage: STAGE.default("TODO"),
  priority: PRIORITY.nullable().optional(),
  dueDate: DAY.nullable().optional(),
  parentId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  /** Top of the column (quick add from the header) instead of the bottom. */
  atTop: z.boolean().optional(),
  /** ADMIN only; anyone else's is ignored. */
  pricing: approvalPricingSchema.optional(),
});

export async function createWorkItem(
  input: z.input<typeof createSchema>,
): Promise<BoardResult<{ item: WorkItem }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid item." };
  const d = parsed.data;
  const dueDate = parseDay(d.dueDate);
  if (d.dueDate && !dueDate) return { ok: false, error: "Pick a valid date" };

  const viewer = await boardAccess(d.projectId);
  if (!viewer) return { ok: false, error: "Project not found." };
  if (viewer.side === "ADMIN" && d.stage === "REQUESTED") {
    return { ok: false, error: "Requested holds the client's asks — pick another stage." };
  }

  const stage = viewer.side === "CLIENT" ? clientAdditionStage(viewer) : d.stage;
  const [refs, place] = await Promise.all([
    checkWorkRefs(viewer, d),
    placeNew(viewer.project.id, stage, d.atTop),
  ]);
  if (!refs.ok) return refs;
  const description = richOrNull(d.description);

  if (viewer.side === "CLIENT") {
    const { row, accepted } = await createClientAddition(
      viewer,
      { ...d, description, dueDate: dueDate ?? null },
      place,
    );
    const quote = description ? clipPreview(richTextExcerpt(description), 280) : null;
    later(() => announceClientAddition(viewer, row, accepted, quote));
    return { ok: true, data: { item: toWorkItem(row, emptyExtras(), viewer, viewer.project.billingType) } };
  }

  const now = new Date();
  const row = await prisma.milestone.create({
    data: {
      projectId: viewer.project.id,
      title: d.title,
      description: description ?? undefined,
      ...stageWrite(stage, null, now),
      position: place.position,
      boardPosition: place.boardPosition,
      priority: d.priority ?? null,
      dueDate: dueDate ?? null,
      parentId: d.parentId ?? null,
      assigneeId: d.assigneeId ?? null,
      // Staff are money-blind: any pricing they send is discarded.
      ...(viewer.role === "ADMIN" && d.pricing ? pricingColumns(d.pricing) : NO_PRICING),
      createdById: viewer.user.id,
      createdByRole: "ADMIN",
    },
    select: itemSelect,
  });

  const actor = displayName(viewer.user);
  later(async () => {
    await logActivity({
      type: "work.created",
      summary: `${actor} added “${row.title}” to ${COLUMN_BY_ID[row.stage].label}`,
      actorId: viewer.user.id,
      clientId: viewer.project.clientId,
      projectId: viewer.project.id,
      entity: "milestone",
      entityId: row.id,
      link: workItemHref(viewer.project.id, row.id, "ADMIN"),
    });
    if (row.assigneeId && row.assigneeId !== viewer.user.id) {
      const forClient = row.assigneeId === viewer.project.clientId;
      await notifyWork(viewer, row, [row.assigneeId], {
        type: "PROJECT_TASK_ASSIGNED",
        title: forClient ? `A task for you: ${row.title}` : `${actor} assigned you: ${row.title}`,
        body: viewer.project.projectName,
        heading: forClient ? "There's a task for you" : "You've been assigned a task",
        intro: `${actor} assigned you a task on ${viewer.project.projectName}.`,
        email: forClient ? "always" : "never",
      });
    }
  });

  return { ok: true, data: { item: toWorkItem(row, emptyExtras(), viewer, viewer.project.billingType) } };
}

const updateSchema = z.object({
  title: TITLE.optional(),
  description: z.unknown().optional(),
  priority: PRIORITY.nullable().optional(),
  dueDate: DAY.nullable().optional(),
  parentId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  /** ADMIN only. The whole pricing choice, validated together. */
  pricing: approvalPricingSchema.optional(),
});

/** What a client may change on their own request while it waits. */
const CLIENT_FIELDS = new Set(["title", "description", "priority", "dueDate"]);

export async function updateWorkItem(
  itemId: string,
  patch: z.input<typeof updateSchema>,
): Promise<BoardResult<{ item: WorkItem }>> {
  const parsed = updateSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid change." };
  const p = parsed.data;
  const dueDate = parseDay(p.dueDate);
  if (p.dueDate && !dueDate) return { ok: false, error: "Pick a valid date" };

  const access = await itemAccess(itemId);
  if (!access) return NOT_FOUND;
  const { viewer, item } = access;
  if (item.archivedAt) return ARCHIVED;
  const touched = Object.keys(patch).filter((k) => k in p || k === "description");
  const descriptionTouched = "description" in patch;

  if (viewer.side === "CLIENT") {
    if (item.createdById !== viewer.user.id || item.stage !== "REQUESTED") {
      return { ok: false, error: "The team has this one now — comment on it instead." };
    }
    if (touched.some((k) => !CLIENT_FIELDS.has(k))) {
      return { ok: false, error: "You can change the title, details, priority and due date of your request." };
    }
  }
  if (p.pricing && viewer.role !== "ADMIN") {
    return { ok: false, error: "Only an admin can change pricing." };
  }

  const refs = await checkWorkRefs(
    viewer,
    { assigneeId: p.assigneeId, parentId: p.parentId },
    { id: item.id, childCount: item._count.children },
  );
  if (!refs.ok) return refs;

  const description = descriptionTouched ? richOrNull(p.description) : undefined;
  const fields = {
    ...(p.title !== undefined ? { title: p.title } : {}),
    ...(description !== undefined ? { description: description ?? Prisma.DbNull } : {}),
    ...(p.priority !== undefined ? { priority: p.priority } : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
  };

  const write = async (): Promise<ItemRow | null> => {
    if (viewer.side === "CLIENT") {
      // The request is the client's own wording; it follows their edits.
      const sync =
        item.sourceTaskRequestId && (p.title !== undefined || description !== undefined)
          ? {
              sourceTaskRequest: {
                update: {
                  ...(p.title !== undefined ? { title: p.title } : {}),
                  ...(description !== undefined ? { description: description ?? EMPTY_DOC } : {}),
                },
              },
            }
          : {};
      try {
        return await prisma.milestone.update({
          // Still waiting: the team may have just decided it.
          where: { id: item.id, stage: "REQUESTED", archivedAt: null },
          data: { ...fields, ...sync },
          select: itemSelect,
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return null;
        throw err;
      }
    }
    const data: Prisma.MilestoneUncheckedUpdateInput = { ...fields };
    if (p.parentId !== undefined) data.parentId = p.parentId;
    if (p.assigneeId !== undefined) data.assigneeId = p.assigneeId;
    if (p.pricing) Object.assign(data, pricingColumns(p.pricing));
    return prisma.milestone.update({ where: { id: item.id }, data, select: itemSelect });
  };
  // The other-table numbers don't depend on this write: same wave.
  const [row, extras] = await Promise.all([write(), itemExtras(item.id, viewer)]);
  if (!row) return { ok: false, error: "The team just picked this up — comment on it instead." };

  const newAssignee = p.assigneeId !== undefined && p.assigneeId !== item.assigneeId ? p.assigneeId : null;
  if (newAssignee && newAssignee !== viewer.user.id) {
    const actor = displayName(viewer.user);
    const crossSide = newAssignee === viewer.project.clientId;
    later(() =>
      notifyWork(viewer, row, [newAssignee], {
        type: "PROJECT_TASK_ASSIGNED",
        title: `${actor} assigned you: ${row.title}`,
        body: viewer.project.projectName,
        heading: crossSide ? "There's a task for you" : "You've been assigned a task",
        intro: `${actor} assigned you a task on ${viewer.project.projectName}.`,
        email: crossSide ? "always" : "never",
      }),
    );
  }

  return { ok: true, data: { item: toWorkItem(row, extras, viewer, viewer.project.billingType) } };
}

/* ------------------------------------------------------------------------ */
/* Moving                                                                   */
/* ------------------------------------------------------------------------ */

const moveSchema = z.object({
  itemId: z.string().min(1),
  stage: STAGE,
  /** Where in the column it was dropped (the midpoint of its new neighbours). */
  boardPosition: z.number(),
  /** Why — required when a client sends work back. */
  comment: z.string().trim().max(5000, "Keep it under 5,000 characters").optional(),
});

/**
 * A drop, or a stage picked from a menu. The board computes the position, so
 * this usually writes one row, in the same wave as it reads the destination
 * column; only when midpoints have worn the gap down to nothing does it
 * renumber the column, and then it hands the new numbers back.
 *
 * A client's moves are verdicts: REVIEW → DONE approves the work (the same
 * write as the portal's Approve button), REVIEW → TODO / IN_PROGRESS sends it
 * back and posts their reason as a comment.
 */
export async function moveWorkItem(
  input: z.input<typeof moveSchema>,
): Promise<BoardResult<{ item: WorkItem; renumbered: { id: string; boardPosition: number }[] }>> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid move." };
  const { stage: to, boardPosition: requested, comment } = parsed.data;

  const access = await itemAccess(parsed.data.itemId);
  if (!access) return NOT_FOUND;
  const { viewer, item } = access;
  const from = item.stage;
  const check = canMoveWorkItem(viewer, item, from, to);
  if (!check.ok) return check;
  if (check.kind === "send-back" && !comment) {
    return { ok: false, error: "Tell the team what needs changing." };
  }

  const write = (boardPosition: number): Promise<ItemRow> => {
    switch (check.kind) {
      case "approve":
        return writeApproval(item, boardPosition);
      case "send-back":
        return writeSendBack(viewer, item, to as "TODO" | "IN_PROGRESS", comment!, boardPosition);
      case "reorder":
        return prisma.milestone.update({
          where: { id: item.id },
          data: { boardPosition },
          select: itemSelect,
        });
      case "move":
        return prisma.milestone.update({
          where: { id: item.id },
          data: {
            ...stageWrite(to, item),
            clientApprovedAt: approvalAfterMove(to, viewer.role, item.clientApprovedAt),
            boardPosition,
          },
          select: itemSelect,
        });
    }
  };

  // A usable position is written straight away, alongside the column read
  // that checks it still has room; an unusable one waits for the column.
  const usable = Number.isFinite(requested) && requested > 0;
  const [first, column, extras] = await Promise.all([
    usable ? write(requested) : null,
    prisma.milestone.findMany({
      where: { projectId: item.projectId, stage: to, archivedAt: null, id: { not: item.id } },
      select: { id: true, boardPosition: true },
    }),
    itemExtras(item.id, viewer),
  ]);
  const plan = placeInColumn(column, item.id, requested);
  const planned = plan.find((r) => r.id === item.id)!.boardPosition;
  let row = first ?? (await write(planned));
  // Anything other than "the item, where it was dropped" is a renumber the
  // board has to hear about — even one that only moved the item itself.
  const renumbered = plan.length > 1 || planned !== requested ? plan : [];
  const pending = plan.filter((r) => r.id !== item.id || r.boardPosition !== row.boardPosition);
  if (pending.length) {
    await prisma.$transaction(
      pending.map((r) =>
        prisma.milestone.update({
          where: { id: r.id },
          data: { boardPosition: r.boardPosition },
          select: { id: true },
        }),
      ),
    );
    row = { ...row, boardPosition: planned };
  }

  if (from !== to) {
    const actor = displayName(viewer.user);
    const label = COLUMN_BY_ID[to].label;
    later(async () => {
      if (check.kind === "approve") return announceApproval(viewer, row);
      if (check.kind === "send-back") return announceSendBack(viewer, row, to, comment!);
      await Promise.all([
        logActivity({
          type: "work.moved",
          summary: `${actor} moved “${row.title}” to ${label}`,
          actorId: viewer.user.id,
          clientId: viewer.project.clientId,
          projectId: viewer.project.id,
          entity: "milestone",
          entityId: row.id,
          link: workItemHref(viewer.project.id, row.id, "ADMIN"),
        }),
        to === "REVIEW" && viewer.project.clientId
          ? notifyWork(viewer, row, [viewer.project.clientId], {
              type: "PROJECT_TASK_REVIEW",
              title: `Ready for your review: ${row.title}`,
              body: viewer.project.projectName,
              heading: "Ready for your review",
              intro: `the team finished a task on ${viewer.project.projectName} and would like your eyes on it. Approve it if it's right, or send it back with a note if it needs changes.`,
              email: "always",
            })
          : null,
      ]);
    });
  }

  return {
    ok: true,
    data: { item: toWorkItem(row, extras, viewer, viewer.project.billingType), renumbered },
  };
}

/* ------------------------------------------------------------------------ */
/* Archive, restore, delete, withdraw                                       */
/* ------------------------------------------------------------------------ */

/**
 * Hide an item, keeping its time, billing and thread. Archiving a phase takes
 * its work with it (restoring brings it back); a client's request still
 * waiting under it is lifted out to the top level instead, since a request
 * is declined, not archived.
 */
export async function archiveWorkItem(itemId: string): Promise<BoardResult<{ id: string }>> {
  const access = await itemAccess(itemId);
  if (!access) return NOT_FOUND;
  const { viewer, item } = access;
  if (viewer.side !== "ADMIN") return { ok: false, error: "Only the team can archive work." };
  if (item.archivedAt) return { ok: true, data: { id: item.id } };
  if (item.stage === "REQUESTED") {
    return { ok: false, error: "Decline the request instead — the client gets your note." };
  }
  await archiveTree(item.id);

  const actor = displayName(viewer.user);
  later(() =>
    logActivity({
      type: "work.archived",
      summary: `${actor} archived “${item.title}”`,
      actorId: viewer.user.id,
      clientId: viewer.project.clientId,
      projectId: viewer.project.id,
      entity: "milestone",
      entityId: item.id,
      link: workItemHref(viewer.project.id, item.id, "ADMIN", "list"),
    }),
  );
  revalidateProject(item.projectId);
  return { ok: true, data: { id: item.id } };
}

/**
 * Bring an item back, with the work archived alongside it. A declined or
 * withdrawn request stays closed: its client would have to ask again, which
 * keeps "Requested" meaning "waiting for a decision".
 */
export async function restoreWorkItem(itemId: string): Promise<BoardResult<{ item: WorkItem }>> {
  const access = await itemAccess(itemId);
  if (!access) return NOT_FOUND;
  const { viewer, item } = access;
  if (viewer.side !== "ADMIN") return { ok: false, error: "Only the team can restore work." };
  if (!item.archivedAt) return { ok: false, error: "This item isn't archived." };
  if (item.stage === "REQUESTED") {
    return { ok: false, error: "A declined request can't be reopened — the client can send it again." };
  }

  const [[row], extras] = await Promise.all([
    prisma.$transaction([
      prisma.milestone.update({
        where: { id: item.id },
        // Back under its phase only if the phase is still there.
        data: {
          archivedAt: null,
          ...(item.parentId && (!item.parent || item.parent.archivedAt) ? { parentId: null } : {}),
        },
        select: itemSelect,
      }),
      // Its own work, archived in the same moment as it was.
      prisma.milestone.updateMany({
        where: { parentId: item.id, archivedAt: item.archivedAt },
        data: { archivedAt: null },
      }),
    ]),
    itemExtras(item.id, viewer),
  ]);

  const actor = displayName(viewer.user);
  later(() =>
    logActivity({
      type: "work.restored",
      summary: `${actor} restored “${item.title}”`,
      actorId: viewer.user.id,
      clientId: viewer.project.clientId,
      projectId: viewer.project.id,
      entity: "milestone",
      entityId: item.id,
      link: workItemHref(viewer.project.id, item.id, "ADMIN"),
    }),
  );
  revalidateProject(item.projectId);
  return { ok: true, data: { item: toWorkItem(row, extras, viewer, viewer.project.billingType) } };
}

/**
 * Delete what has no history; archive what does. Logged hours, invoice lines,
 * a thread or a client's request are records someone may need later, so an
 * item carrying any of them is archived instead (and says so).
 *
 * Only an admin deletes. Staff can't see what an item is priced at, so a
 * "delete" from them could quietly take billable scope off a project; theirs
 * archives instead, which an admin can undo.
 */
export async function deleteWorkItem(
  itemId: string,
): Promise<BoardResult<{ id: string; archived: boolean }>> {
  const access = await itemAccess(itemId);
  if (!access) return NOT_FOUND;
  const { viewer, item } = access;
  if (viewer.side !== "ADMIN") {
    return { ok: false, error: "Withdraw your request instead — the team will see it was withdrawn." };
  }
  const history = viewer.role !== "ADMIN" || (await hasHistory(item));

  const actor = displayName(viewer.user);
  if (history) {
    if (item.stage === "REQUESTED") {
      return { ok: false, error: "Decline the request instead — the client gets your note." };
    }
    if (!item.archivedAt) await archiveTree(item.id);
  } else {
    // Its sub-items stay, at the top level (the relation sets parentId null).
    await prisma.milestone.delete({ where: { id: item.id } });
  }
  later(() =>
    logActivity({
      type: history ? "work.archived" : "work.deleted",
      summary: history
        ? `${actor} archived “${item.title}”`
        : `${actor} deleted “${item.title}”`,
      actorId: viewer.user.id,
      clientId: viewer.project.clientId,
      projectId: viewer.project.id,
      ...(history
        ? { entity: "milestone", entityId: item.id, link: workItemHref(viewer.project.id, item.id, "ADMIN", "list") }
        : {}),
    }),
  );
  revalidateProject(item.projectId);
  return { ok: true, data: { id: item.id, archived: history } };
}

/**
 * A client takes back their own request before the team has decided it. The
 * request is closed as withdrawn, so their history explains where it went,
 * and the item leaves the board.
 */
export async function withdrawWorkItem(itemId: string): Promise<BoardResult<{ id: string }>> {
  const access = await itemAccess(itemId);
  if (!access) return NOT_FOUND;
  const { viewer, item } = access;
  if (viewer.side !== "CLIENT" || item.createdById !== viewer.user.id) {
    return { ok: false, error: "Only the client who asked can withdraw a request." };
  }
  if (item.archivedAt) return { ok: true, data: { id: item.id } };
  if (item.stage !== "REQUESTED") {
    return { ok: false, error: "The team has picked this up — comment on it instead." };
  }

  const now = new Date();
  try {
    if (item.sourceTaskRequestId) {
      await prisma.taskRequest.update({
        where: { id: item.sourceTaskRequestId, status: "PENDING" },
        data: {
          status: "REJECTED",
          adminNote: "Withdrawn by client",
          resolvedAt: now,
          milestone: { update: { archivedAt: now } },
        },
      });
    } else {
      await prisma.milestone.update({ where: { id: item.id }, data: { archivedAt: now } });
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "The team just decided this request." };
    }
    throw err;
  }

  const actor = displayName(viewer.user);
  later(async () => {
    await logActivity({
      type: "work.declined",
      summary: `${actor} withdrew their request “${item.title}”`,
      actorId: viewer.user.id,
      clientId: viewer.project.clientId,
      projectId: viewer.project.id,
      entity: "milestone",
      entityId: item.id,
      link: workItemHref(viewer.project.id, item.id, "ADMIN", "list"),
    });
    await notifyWork(viewer, item, await teamOnPoint(viewer, item.assigneeId), {
      type: "TASK_REQUEST_REJECTED",
      title: `${actor} withdrew a request: ${item.title}`,
      body: viewer.project.projectName,
      heading: "A request was withdrawn",
      intro: `${actor} withdrew a request on ${viewer.project.projectName}.`,
      email: "never",
    });
  });
  revalidatePath("/portal/requests");
  revalidatePath("/admin/task-requests");
  revalidateProject(item.projectId);
  return { ok: true, data: { id: item.id } };
}

/* ------------------------------------------------------------------------ */
/* Comments and help requests                                               */
/* ------------------------------------------------------------------------ */

const commentSchema = z.object({
  itemId: z.string().min(1),
  body: z.string().max(5000, "Keep it under 5,000 characters"),
  mentionIds: z.array(z.string()).max(20).default([]),
  attachments: z
    .array(z.object({ url: z.string().regex(ATTACHMENT_URL), name: z.string().max(255) }))
    .max(6, "Up to six images per comment")
    .default([]),
  kind: z.enum(["COMMENT", "HELP"]).default("COMMENT"),
});

export async function addWorkComment(
  input: z.input<typeof commentSchema>,
): Promise<BoardResult<{ comment: BoardComment; item: WorkItem }>> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  const d = parsed.data;
  const body = d.body.trim();
  if (!body && d.attachments.length === 0) return { ok: false, error: "Write something first." };

  const access = await itemAccess(d.itemId);
  if (!access) return NOT_FOUND;
  const { viewer, item } = access;
  if (item.archivedAt) return ARCHIVED;

  // Only real people on this project, and only those still named in the text
  // — deleting "@Akib" from the draft un-pins him. Attachments must be this
  // user's own uploads. Both checks in one wave.
  const names = d.attachments.map((a) => a.url.split("/").pop()!);
  const [people, owned] = await Promise.all([
    d.mentionIds.length ? listBoardPeople(viewer.project.clientId) : [],
    names.length
      ? prisma.imageUpload.count({ where: { fileName: { in: names }, uploaderId: viewer.user.id } })
      : 0,
  ]);
  if (owned !== new Set(names).size) return { ok: false, error: "One of those images couldn't be attached." };
  const mentions = people
    .filter((p) => d.mentionIds.includes(p.id) && body.includes(`@${p.name}`))
    .map((p) => ({ id: p.id, name: p.name }));

  const row = await prisma.milestoneComment.create({
    data: {
      milestoneId: item.id,
      authorId: viewer.user.id,
      authorRole: viewer.side,
      kind: d.kind,
      body,
      mentions: mentions.length ? mentions : undefined,
      attachments: d.attachments.length ? d.attachments : undefined,
    },
    select: commentSelect,
  });
  const [itemRow, extras] = await Promise.all([
    prisma.milestone.findUniqueOrThrow({ where: { id: item.id }, select: itemSelect }),
    itemExtras(item.id, viewer),
  ]);

  const actor = displayName(viewer.user);
  const quote = body ? clipPreview(body, 280) : "(sent an image)";
  later(async () => {
    const mentioned = mentions.map((m) => m.id);
    // The other side of the conversation.
    const otherSide =
      viewer.side === "CLIENT"
        ? await teamOnPoint(viewer, item.assigneeId)
        : viewer.project.clientId
          ? [viewer.project.clientId]
          : [];
    // A teammate on point hears about a colleague's comment too.
    const teammate =
      viewer.side === "ADMIN" && item.assigneeId && item.assigneeId !== viewer.project.clientId
        ? [item.assigneeId]
        : [];

    if (d.kind === "HELP") {
      await logActivity({
        type: "work.help",
        summary: `${actor} asked for help on “${item.title}”`,
        actorId: viewer.user.id,
        clientId: viewer.project.clientId,
        projectId: viewer.project.id,
        entity: "milestone",
        entityId: item.id,
        link: workItemHref(viewer.project.id, item.id, "ADMIN"),
      });
      await notifyWork(viewer, item, [...otherSide, ...mentioned], {
        type: "PROJECT_TASK_HELP",
        title: `${actor} needs help: ${item.title}`,
        body: quote,
        heading: viewer.side === "CLIENT" ? "Your client needs a hand" : "The team needs your input",
        intro: `${actor} asked for help on a task in ${viewer.project.projectName}.`,
        quote,
        email: "always",
      });
      return;
    }

    if (mentioned.length) {
      await notifyWork(viewer, item, mentioned, {
        type: "PROJECT_TASK_MENTION",
        title: `${actor} mentioned you: ${item.title}`,
        body: quote,
        heading: "You were mentioned",
        intro: `${actor} mentioned you on a task in ${viewer.project.projectName}.`,
        quote,
        email: "always",
      });
    }
    const rest = [...otherSide, ...teammate].filter((id) => !mentioned.includes(id));
    await notifyWork(viewer, item, rest, {
      type: "PROJECT_TASK_COMMENT",
      title: `${actor} commented: ${item.title}`,
      body: quote,
      heading: "New comment on a task",
      intro: `${actor} commented on a task in ${viewer.project.projectName}.`,
      quote,
      email: "quiet",
    });
  });

  return {
    ok: true,
    data: {
      comment: toComment(row),
      item: toWorkItem(itemRow, extras, viewer, viewer.project.billingType),
    },
  };
}

async function commentAccess(commentId: string) {
  const comment = await prisma.milestoneComment.findUnique({
    where: { id: commentId },
    select: { id: true, milestoneId: true, authorId: true, kind: true, resolvedAt: true },
  });
  if (!comment) return null;
  const access = await itemAccess(comment.milestoneId);
  return access ? { ...access, comment } : null;
}

/** Either side may close a help request — the asker, or whoever answered it. */
export async function resolveWorkHelp(
  commentId: string,
): Promise<BoardResult<{ comment: BoardComment; item: WorkItem }>> {
  const access = await commentAccess(commentId);
  if (!access) return { ok: false, error: "Comment not found." };
  const { viewer, item, comment } = access;
  if (comment.kind !== "HELP") return { ok: false, error: "That isn't a help request." };

  const row = comment.resolvedAt
    ? await prisma.milestoneComment.findUniqueOrThrow({ where: { id: comment.id }, select: commentSelect })
    : await prisma.milestoneComment.update({
        where: { id: comment.id },
        data: { resolvedAt: new Date(), resolvedById: viewer.user.id },
        select: commentSelect,
      });
  const [itemRow, extras] = await Promise.all([
    prisma.milestone.findUniqueOrThrow({ where: { id: item.id }, select: itemSelect }),
    itemExtras(item.id, viewer),
  ]);
  return {
    ok: true,
    data: {
      comment: toComment(row),
      item: toWorkItem(itemRow, extras, viewer, viewer.project.billingType),
    },
  };
}

/** Authors delete their own comments; an admin can remove any. */
export async function deleteWorkComment(
  commentId: string,
): Promise<BoardResult<{ id: string; item: WorkItem }>> {
  const access = await commentAccess(commentId);
  if (!access) return { ok: false, error: "Comment not found." };
  const { viewer, item, comment } = access;
  if (comment.authorId !== viewer.user.id && viewer.role !== "ADMIN") {
    return { ok: false, error: "You can only delete your own comments." };
  }
  await prisma.milestoneComment.delete({ where: { id: comment.id } });
  const [itemRow, extras] = await Promise.all([
    prisma.milestone.findUniqueOrThrow({ where: { id: item.id }, select: itemSelect }),
    itemExtras(item.id, viewer),
  ]);
  return {
    ok: true,
    data: { id: comment.id, item: toWorkItem(itemRow, extras, viewer, viewer.project.billingType) },
  };
}
