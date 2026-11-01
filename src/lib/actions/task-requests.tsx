"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireClient, requireTeam } from "@/lib/dal/session";
import {
  taskRequestSchema,
  acceptRequestSchema,
  rejectSchema,
  type TaskRequestInput,
  type AcceptRequestInput,
} from "@/lib/validation/task-request";
import { hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { sendEmail } from "@/lib/email/resend";
import TaskRequestReceivedEmail from "@/emails/task-request-received";
import TaskRequestApprovedEmail from "@/emails/task-request-approved";
import TaskRequestRejectedEmail from "@/emails/task-request-rejected";
import { formatPricing } from "@/lib/format";
import { appUrl } from "@/lib/app-url";
import { clipPreview } from "@/lib/rich-text";
import { logActivity } from "@/lib/dal/activity";
import { boardAccess, type BoardViewer } from "@/lib/dal/project-board";
import { canSeePricing, parseDay, workItemHref, workRole } from "@/lib/board";
import { stageWrite } from "@/lib/work-stage";
import {
  announceClientAddition,
  checkWorkRefs,
  clientAdditionStage,
  createClientAddition,
  displayName,
  later,
  placeNew,
  pricingColumns,
  richTextExcerpt,
} from "@/lib/work-items";

/**
 * A client's requests and the team's decisions on them.
 *
 * Since v49 a request is never a separate thing to convert: submitting one
 * creates the work item itself, waiting in the Requested column, alongside the
 * TaskRequest that records the decision (the client's wording, our note, when
 * we decided). Accepting moves that same item into the plan — priced, placed,
 * assigned; declining archives it, and the client keeps the request, with our
 * note, in their history. A live item is Requested exactly while its request
 * is PENDING.
 *
 * ADMIN decides anything. STAFF are money-blind, so they may accept work only
 * at no charge, and decline.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateRequest(projectId: string) {
  revalidatePath("/admin/task-requests");
  revalidatePath("/portal/requests");
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/portal/projects/${projectId}`);
}

export async function submitTaskRequest(
  input: TaskRequestInput,
): Promise<ActionResult> {
  const user = await requireClient();
  const parsed = taskRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  if (!hasRichTextContent(data.description)) {
    return { ok: false, error: "Describe the task so we know what you need." };
  }

  // The project must belong to the requesting client — never trust the id.
  const viewer = await boardAccess(data.projectId);
  if (!viewer || viewer.user.id !== user.id) return { ok: false, error: "Project not found." };

  const place = await placeNew(viewer.project.id, clientAdditionStage(viewer));
  const description = data.description as Prisma.InputJsonValue;
  const { row, accepted } = await createClientAddition(
    viewer,
    { title: data.title, description },
    place,
  );

  later(async () => {
    await announceClientAddition(
      viewer,
      row,
      accepted,
      clipPreview(richTextExcerpt(description), 280),
    );
    // Automated confirmation back to the client.
    await sendEmail({
      to: user.email,
      subject: `We received your request — ${data.title}`,
      react: (
        <TaskRequestReceivedEmail
          firstName={user.name.split(" ")[0] || "there"}
          title={data.title}
          projectName={viewer.project.projectName}
          portalUrl={`${appUrl()}/portal/requests`}
        />
      ),
      devHint: `request confirmation → ${user.email}`,
    });
  });

  revalidateRequest(viewer.project.id);
  return { ok: true };
}

const requestInclude = {
  client: { select: { id: true, firstName: true, email: true } },
  project: {
    select: {
      id: true,
      projectName: true,
      clientId: true,
      ownerId: true,
      billingType: true,
      autoAcceptClientTasks: true,
    },
  },
  milestone: {
    select: {
      id: true,
      stage: true,
      completedAt: true,
      _count: { select: { children: { where: { archivedAt: null } } } },
    },
  },
} satisfies Prisma.TaskRequestInclude;

function isNotFound(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

/**
 * Accept a request: the waiting item moves into the plan in place — its
 * stage (To do unless told otherwise), price, assignee, due date and phase —
 * and the request is marked approved, in one write. A request from before v49
 * with no item gets one now.
 */
export async function approveTaskRequest(
  id: string,
  input: AcceptRequestInput,
): Promise<ActionResult> {
  const user = await requireTeam();
  const role = workRole(user.role)!;
  const parsed = acceptRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid pricing" };
  }
  const d = parsed.data;
  if (role !== "ADMIN" && d.pricingType !== "NONE") {
    return { ok: false, error: "Only an admin can put a price on it — accept it as no charge, or leave it for an admin." };
  }
  const dueDate = parseDay(d.dueDate);
  if (d.dueDate && !dueDate) return { ok: false, error: "Pick a valid date" };

  const request = await prisma.taskRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "PENDING") {
    return { ok: false, error: "This request was already resolved." };
  }

  const viewer: BoardViewer = { id: user.id, user, role, side: "ADMIN", project: request.project };
  const item = request.milestone;
  const [refs, place] = await Promise.all([
    checkWorkRefs(
      viewer,
      { assigneeId: d.assigneeId, parentId: d.parentId },
      item ? { id: item.id, childCount: item._count.children } : undefined,
    ),
    placeNew(request.projectId, d.stage),
  ]);
  if (!refs.ok) return refs;

  const now = new Date();
  const pricing = pricingColumns(d);
  const placement = {
    ...stageWrite(d.stage, item, now),
    boardPosition: place.boardPosition,
    archivedAt: null,
    ...pricing,
    ...(d.assigneeId !== undefined ? { assigneeId: d.assigneeId } : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(d.parentId !== undefined ? { parentId: d.parentId } : {}),
  };
  let accepted: { id: string; title: string };
  try {
    const updated = await prisma.taskRequest.update({
      // Still waiting: two people deciding at once must not both win.
      where: { id: request.id, status: "PENDING" },
      data: {
        status: "APPROVED",
        resolvedAt: now,
        milestone: item
          ? { update: placement }
          : {
              create: {
                ...placement,
                projectId: request.projectId,
                title: request.title,
                description: request.description as Prisma.InputJsonValue,
                position: place.position,
                createdById: request.clientId,
                createdByRole: "CLIENT",
              },
            },
      },
      select: { milestone: { select: { id: true, title: true } } },
    });
    if (!updated.milestone) throw new Error("accepted request has no work item");
    accepted = updated.milestone;
  } catch (err) {
    if (isNotFound(err)) return { ok: false, error: "This request was already resolved." };
    throw err;
  }

  const pricingLine = canSeePricing("CLIENT", request.project.billingType)
    ? formatPricing(pricing)
    : null;
  const actor = displayName(user);
  later(async () => {
    await Promise.all([
      prisma.notification.create({
        data: {
          userId: request.clientId,
          type: "TASK_REQUEST_APPROVED",
          title: `Request accepted: ${request.title}`,
          body: `Added to ${request.project.projectName}`,
          link: workItemHref(request.projectId, accepted.id, "CLIENT"),
        },
      }),
      logActivity({
        // No price here: the project's activity feed is shown to staff too.
        type: "work.accepted",
        summary: `${actor} accepted “${request.title}”`,
        actorId: user.id,
        clientId: request.clientId,
        projectId: request.projectId,
        entity: "milestone",
        entityId: accepted.id,
        link: workItemHref(request.projectId, accepted.id, "ADMIN"),
      }),
    ]);
    await sendEmail({
      to: request.client.email,
      subject: `Your request was accepted — ${request.title}`,
      react: (
        <TaskRequestApprovedEmail
          firstName={request.client.firstName || "there"}
          title={request.title}
          projectName={request.project.projectName}
          pricingLine={pricingLine}
          portalUrl={`${appUrl()}${workItemHref(request.projectId, accepted.id, "CLIENT")}`}
        />
      ),
      devHint: `approval → ${request.client.email}`,
    });
  });

  revalidateRequest(request.projectId);
  return { ok: true };
}

/**
 * Decline a request, with the reason the client will read. The item leaves
 * the board (archived, so nothing is lost); the request and its note stay in
 * the client's history.
 */
export async function rejectTaskRequest(
  id: string,
  reason: string,
): Promise<ActionResult> {
  const user = await requireTeam();
  const parsed = rejectSchema.safeParse({ reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid reason" };
  }

  const request = await prisma.taskRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "PENDING") {
    return { ok: false, error: "This request was already resolved." };
  }

  const now = new Date();
  try {
    await prisma.taskRequest.update({
      where: { id: request.id, status: "PENDING" },
      data: {
        status: "REJECTED",
        adminNote: parsed.data.reason,
        resolvedAt: now,
        ...(request.milestone ? { milestone: { update: { archivedAt: now } } } : {}),
      },
    });
  } catch (err) {
    if (isNotFound(err)) return { ok: false, error: "This request was already resolved." };
    throw err;
  }

  const actor = displayName(user);
  later(async () => {
    await Promise.all([
      prisma.notification.create({
        data: {
          userId: request.clientId,
          type: "TASK_REQUEST_REJECTED",
          title: `Request declined: ${request.title}`,
          body: parsed.data.reason,
          link: "/portal/requests",
        },
      }),
      logActivity({
        type: "work.declined",
        summary: `${actor} declined “${request.title}”`,
        actorId: user.id,
        clientId: request.clientId,
        projectId: request.projectId,
        entity: "milestone",
        entityId: request.milestone?.id ?? null,
        link: request.milestone
          ? workItemHref(request.projectId, request.milestone.id, "ADMIN", "list")
          : "/admin/task-requests",
      }),
    ]);
    await sendEmail({
      to: request.client.email,
      subject: `Update on your request — ${request.title}`,
      react: (
        <TaskRequestRejectedEmail
          firstName={request.client.firstName || "there"}
          title={request.title}
          projectName={request.project.projectName}
          reason={parsed.data.reason}
          portalUrl={`${appUrl()}/portal/requests`}
        />
      ),
      devHint: `rejection → ${request.client.email}`,
    });
  });

  revalidateRequest(request.projectId);
  return { ok: true };
}
