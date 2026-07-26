"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/dal/session";
import { notifyAllAdmins } from "@/lib/dal/notifications";
import { logActivity } from "@/lib/dal/activity";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Client approves a COMPLETED milestone on one of their own projects.
 * In-app admin notification only — no email (anti-spam rule).
 */
export async function approveMilestone(id: string): Promise<ActionResult> {
  const user = await requireClient();

  const milestone = await prisma.milestone.findFirst({
    where: { id, project: { clientId: user.id } },
    include: { project: { select: { id: true, projectName: true } } },
  });
  if (!milestone) return { ok: false, error: "Milestone not found." };
  if (milestone.status !== "COMPLETED") {
    return { ok: false, error: "Only completed milestones can be approved." };
  }
  if (milestone.clientApprovedAt) return { ok: true }; // already approved

  await prisma.milestone.update({
    where: { id },
    data: { clientApprovedAt: new Date() },
  });
  await notifyAllAdmins({
    type: "MILESTONE_APPROVED",
    title: `${user.firstName || "Client"} approved: ${milestone.title}`,
    body: `on ${milestone.project.projectName}`,
    link: `/admin/projects/${milestone.project.id}`,
  });
  await logActivity({
    type: "milestone.approved",
    summary: `${user.firstName || "Client"} approved milestone: ${milestone.title}`,
    actorId: user.id,
    clientId: user.id,
    entity: "project",
    entityId: milestone.project.id,
    link: `/admin/projects/${milestone.project.id}`,
  });

  revalidatePath(`/portal/projects/${milestone.project.id}`);
  revalidatePath(`/admin/projects/${milestone.project.id}`);
  return { ok: true };
}

/**
 * Client rates satisfaction on a COMPLETED milestone: 1 = 👍, -1 = 👎, with an
 * optional note. Idempotent-ish — re-rating overwrites. In-app admin notice only.
 */
export async function rateMilestone(
  id: string,
  rating: 1 | -1,
  note?: string,
): Promise<ActionResult> {
  const user = await requireClient();
  if (rating !== 1 && rating !== -1) {
    return { ok: false, error: "Invalid rating." };
  }

  const milestone = await prisma.milestone.findFirst({
    where: { id, project: { clientId: user.id } },
    include: { project: { select: { id: true, projectName: true } } },
  });
  if (!milestone) return { ok: false, error: "Milestone not found." };
  if (milestone.status !== "COMPLETED") {
    return { ok: false, error: "Only completed milestones can be rated." };
  }

  const trimmed = note?.trim().slice(0, 1000) || null;
  await prisma.milestone.update({
    where: { id },
    data: { clientRating: rating, clientRatingNote: trimmed, ratedAt: new Date() },
  });
  await notifyAllAdmins({
    type: "MILESTONE_UPDATED",
    title: `${user.firstName || "Client"} rated ${rating === 1 ? "👍" : "👎"}: ${milestone.title}`,
    body: trimmed ? `“${trimmed}”` : `on ${milestone.project.projectName}`,
    link: `/admin/projects/${milestone.project.id}`,
  });

  revalidatePath(`/portal/projects/${milestone.project.id}`);
  revalidatePath(`/admin/projects/${milestone.project.id}`);
  return { ok: true };
}

/**
 * Client reports having sent the payment for one of their invoices.
 * Moves the invoice to IN_REVIEW; the admin confirms by marking it PAID.
 */
export async function claimInvoicePayment(id: string): Promise<ActionResult> {
  const user = await requireClient();

  const invoice = await prisma.invoice.findFirst({
    where: { id, clientId: user.id },
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status === "PAID") {
    return { ok: false, error: "This invoice is already marked as paid." };
  }
  if (invoice.paymentClaimedAt) return { ok: true }; // already reported

  await prisma.invoice.update({
    where: { id },
    data: { paymentClaimedAt: new Date(), status: "IN_REVIEW" },
  });
  await notifyAllAdmins({
    type: "PAYMENT_CLAIMED",
    title: `${user.firstName || "Client"} says ${invoice.invoiceNumber} is paid`,
    body: "Confirm the transfer and mark it paid.",
    link: `/admin/invoices/${invoice.id}`,
  });
  await logActivity({
    type: "invoice.claimed",
    summary: `${user.firstName || "Client"} reported paying ${invoice.invoiceNumber}`,
    actorId: user.id,
    clientId: user.id,
    entity: "invoice",
    entityId: invoice.id,
    link: `/admin/invoices/${invoice.id}`,
  });

  revalidatePath(`/portal/invoices/${id}`);
  revalidatePath("/portal/invoices");
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin/invoices");
  return { ok: true };
}
