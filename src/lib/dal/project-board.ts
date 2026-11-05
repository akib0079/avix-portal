import "server-only";
import { prisma } from "@/lib/prisma";
import { getSession, requireTeam } from "@/lib/dal/session";
import type { SessionUser } from "@/lib/auth";
import type { JSONContent } from "@tiptap/react";
import type { Prisma, ProjectBillingType } from "@prisma/client";
import { hasRichTextContent } from "@/components/editor/rich-text-viewer";
import {
  canSeePricing,
  dayKey,
  sideOfRole,
  workRole,
  workVersion,
  type BoardAttachment,
  type BoardComment,
  type BoardData,
  type BoardMention,
  type BoardPerson,
  type BoardPhase,
  type BoardSide,
  type WorkBilling,
  type WorkItem,
  type WorkItemDetail,
  type WorkRole,
  type WorkVersionRow,
} from "@/lib/board";

/**
 * Reads for project work: the Milestones list, the board, the board's poll
 * and the item drawer. Since v49 every piece of work is one Milestone row; the
 * v48 board tables (project_tasks, project_task_comments) are frozen and
 * never read.
 *
 * Access is one rule everywhere: the team (admin or staff) sees every
 * project's work; a client sees only projects they own. Each read takes its
 * viewer from the session — or from a caller that already resolved it — and
 * scopes its own query by it, so none of them trusts an id it was handed.
 *
 * Money is stripped here, per viewer, so it never reaches a payload that
 * shouldn't carry it (hiding it in the UI would not be enough): STAFF get no
 * prices, estimates or billing; a client gets their own prices, as the portal
 * timeline always showed, but never billing; only ADMIN sees invoice links.
 */

export type WorkViewer = { id: string; role: WorkRole };

/** The signed-in viewer for work reads, or null when they may read none. */
export async function currentWorkViewer(): Promise<(WorkViewer & { user: SessionUser }) | null> {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") return null;
  const role = workRole(session.user.role);
  return role ? { id: session.user.id, role, user: session.user } : null;
}

/** A viewer resolved against one project, for the write actions. */
export type BoardViewer = WorkViewer & {
  user: SessionUser;
  side: BoardSide;
  project: {
    id: string;
    projectName: string;
    clientId: string | null;
    ownerId: string | null;
    billingType: ProjectBillingType;
    autoAcceptClientTasks: boolean;
  };
};

const projectSelect = {
  id: true,
  projectName: true,
  clientId: true,
  ownerId: true,
  billingType: true,
  autoAcceptClientTasks: true,
} as const;

function projectScope(viewer: WorkViewer, projectId: string): Prisma.ProjectWhereInput {
  return viewer.role === "CLIENT" ? { id: projectId, clientId: viewer.id } : { id: projectId };
}

function itemScope(viewer: WorkViewer, itemId: string): Prisma.MilestoneWhereInput {
  return viewer.role === "CLIENT"
    ? { id: itemId, project: { clientId: viewer.id } }
    : { id: itemId };
}

/** The signed-in viewer's access to a project's work, or null for none. */
export async function boardAccess(projectId: string): Promise<BoardViewer | null> {
  const viewer = await currentWorkViewer();
  if (!viewer) return null;
  const project = await prisma.project.findFirst({
    where: projectScope(viewer, projectId),
    select: projectSelect,
  });
  return project
    ? { id: viewer.id, user: viewer.user, role: viewer.role, side: sideOfRole(viewer.role), project }
    : null;
}

/**
 * The same rule reached through an item. Returns the item's raw row too —
 * everything the write actions check, without the description.
 */
export async function itemAccess(itemId: string) {
  const viewer = await currentWorkViewer();
  if (!viewer) return null;
  const item = await prisma.milestone.findFirst({
    where: itemScope(viewer, itemId),
    omit: { description: true },
    include: {
      project: { select: projectSelect },
      parent: { select: { archivedAt: true, parentId: true } },
      _count: { select: { children: { where: { archivedAt: null } } } },
    },
  });
  if (!item) return null;
  const board: BoardViewer = {
    id: viewer.id,
    user: viewer.user,
    role: viewer.role,
    side: sideOfRole(viewer.role),
    project: item.project,
  };
  return { viewer: board, item };
}

export type AccessedItem = NonNullable<Awaited<ReturnType<typeof itemAccess>>>["item"];

/* ------------------------------------------------------------------------ */
/* Work items                                                               */
/* ------------------------------------------------------------------------ */

/**
 * What a list row or a card shows. relationJoins makes the people and the
 * counts part of the one statement. The description is read only to answer
 * "has details?"; it never leaves the server from here.
 */
export const itemSelect = {
  id: true,
  title: true,
  stage: true,
  status: true,
  position: true,
  boardPosition: true,
  priority: true,
  dueDate: true,
  parentId: true,
  assigneeId: true,
  createdById: true,
  createdByRole: true,
  description: true,
  completedAt: true,
  clientApprovedAt: true,
  clientRating: true,
  clientRatingNote: true,
  sourceTaskRequestId: true,
  archivedAt: true,
  pricingType: true,
  hourlyRate: true,
  fixedPrice: true,
  estimatedHours: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, firstName: true, lastName: true, name: true, image: true } },
  createdBy: { select: { firstName: true, lastName: true, name: true } },
  _count: { select: { comments: true, children: { where: { archivedAt: null } } } },
} satisfies Prisma.MilestoneSelect;

export type ItemRow = Prisma.MilestoneGetPayload<{ select: typeof itemSelect }>;

/** The per-item numbers that come from other tables. */
export type ItemExtras = {
  help: Map<string, { client: number; team: number }>;
  hours: Map<string, number>;
  billing: Map<string, WorkBilling[]>;
};

export function personName(u: { firstName?: string | null; lastName?: string | null; name: string }) {
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.name;
}

const NO_HELP = { client: 0, team: 0 };

export function toWorkItem(
  row: ItemRow,
  extras: ItemExtras,
  viewer: WorkViewer,
  billingType: ProjectBillingType,
): WorkItem {
  const help = extras.help.get(row.id) ?? NO_HELP;
  const priced = canSeePricing(viewer.role, billingType);
  const num = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));
  return {
    id: row.id,
    title: row.title,
    stage: row.stage,
    status: row.status,
    position: row.position,
    boardPosition: row.boardPosition,
    priority: row.priority,
    dueDate: row.dueDate ? dayKey(row.dueDate) : null,
    parentId: row.parentId,
    childCount: row._count.children,
    assigneeId: row.assigneeId,
    assignee: row.assignee
      ? { id: row.assignee.id, name: personName(row.assignee), image: row.assignee.image }
      : null,
    createdById: row.createdById,
    createdByRole: row.createdByRole,
    creatorName: row.createdBy ? personName(row.createdBy) : null,
    hasDescription: hasRichTextContent(row.description),
    commentCount: row._count.comments,
    openHelp: help,
    helpFrom: help.client > 0 ? "CLIENT" : help.team > 0 ? "ADMIN" : null,
    loggedHours: extras.hours.get(row.id) ?? 0,
    // Money-blind: STAFF get the shape of an unpriced item and nothing else.
    estimatedHours: priced ? num(row.estimatedHours) : null,
    pricingType: priced ? row.pricingType : "NONE",
    hourlyRate: priced ? num(row.hourlyRate) : null,
    fixedPrice: priced ? num(row.fixedPrice) : null,
    billedOn: viewer.role === "ADMIN" ? (extras.billing.get(row.id) ?? []) : [],
    completedAt: row.completedAt?.toISOString() ?? null,
    clientApprovedAt: row.clientApprovedAt?.toISOString() ?? null,
    clientRating: row.clientRating,
    clientRatingNote: row.clientRatingNote,
    sourceTaskRequestId: row.sourceTaskRequestId,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Unanswered help requests per item, by the side that asked. */
async function openHelpFor(where: Prisma.MilestoneCommentWhereInput) {
  const groups = await prisma.milestoneComment.groupBy({
    by: ["milestoneId", "authorRole"],
    where: { ...where, kind: "HELP", resolvedAt: null },
    _count: { _all: true },
  });
  const map = new Map<string, { client: number; team: number }>();
  for (const g of groups) {
    const cur = map.get(g.milestoneId) ?? { client: 0, team: 0 };
    if (g.authorRole === "CLIENT") cur.client += g._count._all;
    else cur.team += g._count._all;
    map.set(g.milestoneId, cur);
  }
  return map;
}

/** Logged hours per item, summed in the database rather than row by row. */
async function hoursFor(where: Prisma.TimeEntryWhereInput) {
  const groups = await prisma.timeEntry.groupBy({
    by: ["milestoneId"],
    where,
    _sum: { hours: true },
  });
  return new Map(groups.map((g) => [g.milestoneId, Number(g._sum.hours ?? 0)]));
}

/**
 * The invoices each item is billed on. ADMIN only — callers never run this
 * for anyone else. A cancelled invoice frees the work again, so it doesn't
 * count; a draft does (the line is already on an invoice being prepared).
 */
async function billingFor(where: Prisma.InvoiceItemWhereInput) {
  const lines = await prisma.invoiceItem.findMany({
    where: { ...where, milestoneId: { not: null }, invoice: { status: { not: "CANCELLED" } } },
    select: {
      milestoneId: true,
      invoice: { select: { id: true, invoiceNumber: true, status: true } },
    },
  });
  const map = new Map<string, WorkBilling[]>();
  for (const line of lines) {
    if (!line.milestoneId) continue;
    const list = map.get(line.milestoneId) ?? [];
    if (!list.some((b) => b.invoiceId === line.invoice.id)) {
      list.push({
        invoiceId: line.invoice.id,
        invoiceNumber: line.invoice.invoiceNumber,
        status: line.invoice.status,
      });
    }
    map.set(line.milestoneId, list);
  }
  return map;
}

/**
 * The other-table numbers for one item, for an action that just wrote it.
 * Start it in the same Promise.all as the write: none of it depends on the
 * write, so it costs no extra round trip.
 */
export async function itemExtras(itemId: string, viewer: WorkViewer): Promise<ItemExtras> {
  const [help, hours, billing] = await Promise.all([
    openHelpFor({ milestoneId: itemId }),
    hoursFor({ milestoneId: itemId }),
    viewer.role === "ADMIN" ? billingFor({ milestoneId: itemId }) : new Map<string, WorkBilling[]>(),
  ]);
  return { help, hours, billing };
}

/** Extras for an item that has none yet (it was just created). */
export function emptyExtras(): ItemExtras {
  return { help: new Map(), hours: new Map(), billing: new Map() };
}

/**
 * A project's work items as both views draw them, in plan order. The live
 * read is every live item: the counts, the attention lists and the plan's
 * reorder all assume the whole plan is here, so a cap would hide the newest
 * work first. Only the archive is bounded, newest archived first.
 *
 * The viewer defaults to the session (React's cache shares that lookup with
 * the page's own requireTeam/requireClient), and the reads are scoped by it:
 * a client asking about someone else's project gets an empty list. So a page
 * can start this in the same wave as its other reads.
 *
 * `archived` lists the archive instead of the live items.
 */
export async function getWorkItems(
  projectId: string,
  viewer?: WorkViewer | null,
  opts: { archived?: boolean } = {},
): Promise<WorkItem[]> {
  const who = viewer === undefined ? await currentWorkViewer() : viewer;
  if (!who) return [];
  const live: Prisma.MilestoneWhereInput = {
    projectId,
    archivedAt: opts.archived ? { not: null } : null,
  };
  const [rows, help, hours, billing] = await Promise.all([
    prisma.milestone.findMany({
      // The client's scope is part of the query: someone else's project
      // simply has no rows. The other reads are only joined to these.
      where: who.role === "CLIENT" ? { ...live, project: { clientId: who.id } } : live,
      orderBy: opts.archived
        ? [{ archivedAt: "desc" }, { position: "asc" }]
        : [{ position: "asc" }, { createdAt: "asc" }],
      ...(opts.archived ? { take: 500 } : {}),
      select: { ...itemSelect, project: { select: { billingType: true } } },
    }),
    openHelpFor({ milestone: live }),
    hoursFor({ milestone: live }),
    who.role === "ADMIN"
      ? billingFor({ milestone: live })
      : Promise.resolve(new Map<string, WorkBilling[]>()),
  ]);
  const extras = { help, hours, billing };
  return rows.map((row) => toWorkItem(row, extras, who, row.project.billingType));
}

/**
 * The phases other work can be grouped under: live, accepted, top-level
 * items, in plan order. Derived from the items already loaded — no query.
 */
export function phasesOf(items: WorkItem[]): BoardPhase[] {
  return items
    .filter((i) => !i.parentId && !i.archivedAt && i.stage !== "REQUESTED")
    .sort((a, b) => a.position - b.position)
    .map((i) => ({ id: i.id, title: i.title }));
}

type VersionQueryRow = {
  itemsAt: Date | null;
  items: number;
  commentsAt: Date | null;
  comments: number;
  hours: number;
  hoursMix: number;
  entries: number;
  billedAt: Date | null;
  billed: number;
};

/**
 * The poll's change token for a project, or null when the viewer may not see
 * it. One statement does both jobs: the WHERE on projects is the access check
 * (a client must own the project), and the lateral aggregates are everything
 * the token covers (see workVersion).
 */
export async function getWorkVersion(
  projectId: string,
  viewer?: WorkViewer | null,
): Promise<string | null> {
  const who = viewer === undefined ? await currentWorkViewer() : viewer;
  if (!who) return null;
  const clientId = who.role === "CLIENT" ? who.id : null;
  const rows = await prisma.$queryRaw<VersionQueryRow[]>`
    SELECT w."itemsAt", w."items", c."commentsAt", c."comments",
           t."hours", t."hoursMix", t."entries", b."billedAt", b."billed"
    FROM "projects" p
    CROSS JOIN LATERAL (
      SELECT max(m."updatedAt") AS "itemsAt", count(*)::int AS "items"
      FROM "milestones" m
      WHERE m."projectId" = p."id" AND m."archivedAt" IS NULL
    ) w
    CROSS JOIN LATERAL (
      SELECT max(GREATEST(mc."createdAt", mc."resolvedAt")) AS "commentsAt",
             count(*)::int AS "comments"
      FROM "milestone_comments" mc
      JOIN "milestones" m ON m."id" = mc."milestoneId"
      WHERE m."projectId" = p."id" AND m."archivedAt" IS NULL
    ) c
    CROSS JOIN LATERAL (
      -- hoursMix weighs each entry by a hash of its item, so hours moved from
      -- one item to another change the token even when the total doesn't.
      SELECT COALESCE(sum(te."hours"), 0)::float8 AS "hours",
             COALESCE(sum(te."hours" * ((hashtext(te."milestoneId")::bigint & 1048575) + 1)), 0)::float8
               AS "hoursMix",
             count(*)::int AS "entries"
      FROM "time_entries" te
      JOIN "milestones" m ON m."id" = te."milestoneId"
      WHERE m."projectId" = p."id" AND m."archivedAt" IS NULL
    ) t
    CROSS JOIN LATERAL (
      SELECT max(i."updatedAt") AS "billedAt", count(*)::int AS "billed"
      FROM "invoice_items" ii
      JOIN "invoices" i ON i."id" = ii."invoiceId"
      JOIN "milestones" m ON m."id" = ii."milestoneId"
      WHERE m."projectId" = p."id" AND m."archivedAt" IS NULL AND i."status" <> 'CANCELLED'
    ) b
    WHERE p."id" = ${projectId} AND (${clientId}::text IS NULL OR p."clientId" = ${clientId}::text)`;
  const row = rows[0];
  if (!row) return null;
  const version: WorkVersionRow = {
    itemsAt: row.itemsAt,
    items: Number(row.items),
    commentsAt: row.commentsAt,
    comments: Number(row.comments),
    hours: Number(row.hours),
    hoursMix: Number(row.hoursMix),
    entries: Number(row.entries),
    billedAt: row.billedAt,
    billed: Number(row.billed),
  };
  return workVersion(version, { billing: who.role === "ADMIN" });
}

/**
 * Everyone an item can be assigned to or a comment can mention: the active
 * team, plus this project's client. Names only — no emails reach a client
 * payload. Takes a bare id and checks nothing: callers authorize first (the
 * poll through getWorkVersion, the pages through their own ownership check).
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

/** The same people, when the project's client is already known. */
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
 * The poll's full answer, once getWorkVersion has said the viewer may see the
 * project and something changed.
 */
export async function getBoard(
  projectId: string,
  viewer: WorkViewer,
  version: string,
): Promise<BoardData> {
  const [items, people] = await Promise.all([
    getWorkItems(projectId, viewer),
    getBoardPeople(projectId),
  ]);
  return { items, people, phases: phasesOf(items), version };
}

/* ------------------------------------------------------------------------ */
/* Comments and the drawer                                                  */
/* ------------------------------------------------------------------------ */

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
} satisfies Prisma.MilestoneCommentSelect;

type CommentRow = Prisma.MilestoneCommentGetPayload<{ select: typeof commentSelect }>;

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

/** How many entries the drawer shows; the totals come from the aggregate. */
const RECENT_TIME_ENTRIES = 20;

/**
 * An item opened in the drawer: the item, its description, its thread (the
 * newest few hundred comments — a thread, not an archive), its recent hours,
 * and the request it came from, whose note explains a decline. Archived items
 * open too, read-only, so old links and declined requests still show.
 *
 * Every read is keyed by the item and runs in one wave; the item read is
 * scoped by the viewer, and nothing is returned unless it finds the item.
 */
export async function getWorkItemDetail(
  itemId: string,
  viewer?: WorkViewer | null,
): Promise<WorkItemDetail | null> {
  const who = viewer === undefined ? await currentWorkViewer() : viewer;
  if (!who) return null;
  const [row, comments, extras, entries] = await Promise.all([
    prisma.milestone.findFirst({
      where: itemScope(who, itemId),
      select: {
        ...itemSelect,
        project: { select: { billingType: true } },
        sourceTaskRequest: { select: { status: true, adminNote: true, resolvedAt: true } },
      },
    }),
    prisma.milestoneComment.findMany({
      where: { milestoneId: itemId },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: commentSelect,
    }),
    itemExtras(itemId, who),
    prisma.timeEntry.findMany({
      where: { milestoneId: itemId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: RECENT_TIME_ENTRIES,
      select: {
        id: true,
        date: true,
        hours: true,
        note: true,
        user: { select: { firstName: true, lastName: true, name: true } },
      },
    }),
  ]);
  if (!row) return null;
  const team = who.role !== "CLIENT";
  const request = row.sourceTaskRequest;
  return {
    item: toWorkItem(row, extras, who, row.project.billingType),
    description: (row.description as JSONContent | null) ?? null,
    comments: comments.reverse().map(toComment),
    timeEntries: entries.map((e) => ({
      id: e.id,
      date: dayKey(e.date),
      hours: Number(e.hours),
      note: e.note,
      userName: team && e.user ? personName(e.user) : null,
    })),
    request: request
      ? {
          status: request.status,
          adminNote: request.adminNote,
          resolvedAt: request.resolvedAt?.toISOString() ?? null,
        }
      : null,
  };
}

/**
 * Per project: how many live items carry a client's help request nobody has
 * answered. For the projects board, where a card needs to say "your client
 * is stuck" without opening the project. One grouped query.
 */
export async function openClientHelpByProject(): Promise<Map<string, number>> {
  await requireTeam();
  const groups = await prisma.milestone.groupBy({
    by: ["projectId"],
    where: {
      archivedAt: null,
      comments: { some: { kind: "HELP", resolvedAt: null, authorRole: "CLIENT" } },
    },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.projectId, g._count._all]));
}
