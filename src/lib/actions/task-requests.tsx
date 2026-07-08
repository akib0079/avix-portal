"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireClient } from "@/lib/dal/session";
import {
  taskRequestSchema,
  approvalPricingSchema,
  rejectSchema,
  type TaskRequestInput,
  type ApprovalPricingInput,
} from "@/lib/validation/task-request";
import { hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { notifyAllAdmins } from "@/lib/dal/notifications";
import { sendEmail } from "@/lib/email/resend";
import TaskRequestSubmittedEmail from "@/emails/task-request-submitted";
import TaskRequestReceivedEmail from "@/emails/task-request-received";
import TaskRequestApprovedEmail from "@/emails/task-request-approved";
import TaskRequestRejectedEmail from "@/emails/task-request-rejected";
import { formatPricing } from "@/lib/format";
import type { Prisma } from "@prisma/client";

export type ActionResult = { ok: true } | { ok: false; error: string };

import { appUrl } from "@/lib/app-url";

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
  const project = await prisma.project.findFirst({
    where: { id: data.projectId, clientId: user.id },
    select: { id: true, projectName: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  await prisma.taskRequest.create({
    data: {
      title: data.title,
      description: data.description as Prisma.InputJsonValue,
      projectId: project.id,
      clientId: user.id,
    },
  });

  await notifyAllAdmins({
    type: "TASK_REQUEST_SUBMITTED",
    title: `New task request from ${user.name}`,
    body: `“${data.title}” on ${project.projectName}`,
    link: "/admin/task-requests",
  });

  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (adminEmail) {
    await sendEmail({
      to: adminEmail,
      subject: `New task request: ${data.title}`,
      react: (
        <TaskRequestSubmittedEmail
          clientName={user.name}
          projectName={project.projectName}
          title={data.title}
          adminUrl={`${appUrl()}/admin/task-requests`}
        />
      ),
      devHint: `task request "${data.title}" → ${adminEmail}`,
    });
  }

  // Automated confirmation back to the client.
  await sendEmail({
    to: user.email,
    subject: `We received your request — ${data.title}`,
    react: (
      <TaskRequestReceivedEmail
        firstName={user.name.split(" ")[0] || "there"}
        title={data.title}
        projectName={project.projectName}
        portalUrl={`${appUrl()}/portal/requests`}
      />
    ),
    devHint: `request confirmation → ${user.email}`,
  });

  revalidatePath("/portal/requests");
  revalidatePath("/admin/task-requests");
  return { ok: true };
}

export async function approveTaskRequest(
  id: string,
  pricing: ApprovalPricingInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = approvalPricingSchema.safeParse(pricing);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid pricing" };
  }
  const data = parsed.data;

  const request = await prisma.taskRequest.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, firstName: true, email: true } },
      project: { select: { id: true, projectName: true } },
    },
  });
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "PENDING") {
    return { ok: false, error: "This request was already resolved." };
  }

  const pricingData = {
    pricingType: data.pricingType,
    hourlyRate: data.pricingType === "HOURLY" ? data.hourlyRate : null,
    estimatedHours: data.pricingType === "HOURLY" ? (data.estimatedHours ?? null) : null,
    fixedPrice: data.pricingType === "FIXED" ? data.fixedPrice : null,
  };

  await prisma.$transaction(async (tx) => {
    const last = await tx.milestone.aggregate({
      where: { projectId: request.projectId },
      _max: { position: true },
    });
    await tx.milestone.create({
      data: {
        projectId: request.projectId,
        title: request.title,
        description: request.description as Prisma.InputJsonValue,
        position: (last._max.position ?? -1) + 1,
        sourceTaskRequestId: request.id,
        ...pricingData,
      },
    });
    await tx.taskRequest.update({
      where: { id },
      data: { status: "APPROVED", resolvedAt: new Date() },
    });
    await tx.notification.create({
      data: {
        userId: request.clientId,
        type: "TASK_REQUEST_APPROVED",
        title: `Request approved: ${request.title}`,
        body: `Added to ${request.project.projectName}`,
        link: `/portal/projects/${request.projectId}`,
      },
    });
  });

  const pricingLine = formatPricing({
    ...pricingData,
    hourlyRate: pricingData.hourlyRate ?? null,
    estimatedHours: pricingData.estimatedHours ?? null,
    fixedPrice: pricingData.fixedPrice ?? null,
  });

  await sendEmail({
    to: request.client.email,
    subject: `Your task request was approved — ${request.title}`,
    react: (
      <TaskRequestApprovedEmail
        firstName={request.client.firstName || "there"}
        title={request.title}
        projectName={request.project.projectName}
        pricingLine={pricingLine}
        portalUrl={`${appUrl()}/portal/projects/${request.projectId}`}
      />
    ),
    devHint: `approval → ${request.client.email}`,
  });

  revalidatePath("/admin/task-requests");
  revalidatePath(`/admin/projects/${request.projectId}`);
  revalidatePath("/portal/requests");
  return { ok: true };
}

export async function rejectTaskRequest(
  id: string,
  reason: string,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = rejectSchema.safeParse({ reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid reason" };
  }

  const request = await prisma.taskRequest.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, firstName: true, email: true } },
      project: { select: { id: true, projectName: true } },
    },
  });
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "PENDING") {
    return { ok: false, error: "This request was already resolved." };
  }

  await prisma.$transaction([
    prisma.taskRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        adminNote: parsed.data.reason,
        resolvedAt: new Date(),
      },
    }),
    prisma.notification.create({
      data: {
        userId: request.clientId,
        type: "TASK_REQUEST_REJECTED",
        title: `Request declined: ${request.title}`,
        body: parsed.data.reason,
        link: "/portal/requests",
      },
    }),
  ]);

  await sendEmail({
    to: request.client.email,
    subject: `Update on your task request — ${request.title}`,
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

  revalidatePath("/admin/task-requests");
  revalidatePath("/portal/requests");
  return { ok: true };
}
