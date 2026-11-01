"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/dal/session";
import { notifyAllAdmins } from "@/lib/dal/notifications";
import { logActivity } from "@/lib/dal/activity";
import { itemAccess } from "@/lib/dal/project-board";
import {
  announceApproval,
  announceSendBack,
  later,
  writeApproval,
  writeSendBack,
} from "@/lib/work-items";

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateProject(projectId: string) {
  revalidatePath(`/portal/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/portal/actions");
}

/**
 * Client approves work the team sent for review: it moves to Done, approved.
 * The same write as approving by dragging the card to Done on the board.
 * Work finished before v49 (Done, never approved) can still be approved; it
 * just gets the stamp. In-app admin notification only — no email.
 */
export async function approveMilestone(id: string): Promise<ActionResult> {
  await requireClient();
  const access = await itemAccess(id);
  if (!access || access.viewer.side !== "CLIENT") return { ok: false, error: "Milestone not found." };
  const { viewer, item } = access;
  if (item.archivedAt) return { ok: false, error: "Milestone not found." };
  if (item.clientApprovedAt) return { ok: true }; // already approved

  if (item.stage === "REVIEW") {
    await writeApproval(item);
  } else if (item.stage === "DONE") {
    await prisma.milestone.update({ where: { id: item.id }, data: { clientApprovedAt: new Date() } });
  } else {
    return { ok: false, error: "Only work that's ready for your review can be approved." };
  }

  later(() => announceApproval(viewer, item));
  revalidateProject(item.projectId);
  return { ok: true };
}

/**
 * Client sends work in review back to the team, saying what needs changing.
 * The note is posted on the item, where the team will work from it.
 */
export async function sendBackMilestone(id: string, comment: string): Promise<ActionResult> {
  await requireClient();
  const note = comment.trim().slice(0, 5000);
  if (!note) return { ok: false, error: "Tell the team what needs changing." };
  const access = await itemAccess(id);
  if (!access || access.viewer.side !== "CLIENT") return { ok: false, error: "Milestone not found." };
  const { viewer, item } = access;
  if (item.archivedAt || item.stage !== "REVIEW") {
    return { ok: false, error: "Only work that's waiting for your review can be sent back." };
  }

  await writeSendBack(viewer, item, "IN_PROGRESS", note);
  later(() => announceSendBack(viewer, item, "IN_PROGRESS", note));
  revalidateProject(item.projectId);
  return { ok: true };
}

/**
 * Client rates satisfaction on finished work: 1 = 👍, -1 = 👎, with an
 * optional note. Top-level items only — a phase or a milestone, not every
 * small task inside one. Re-rating overwrites. In-app admin notice only.
 */
export async function rateMilestone(
  id: string,
  rating: 1 | -1,
  note?: string,
): Promise<ActionResult> {
  await requireClient();
  if (rating !== 1 && rating !== -1) {
    return { ok: false, error: "Invalid rating." };
  }

  const access = await itemAccess(id);
  if (!access || access.viewer.side !== "CLIENT") return { ok: false, error: "Milestone not found." };
  const { viewer, item } = access;
  if (item.archivedAt || item.stage !== "DONE" || item.parentId) {
    return { ok: false, error: "Only finished milestones can be rated." };
  }

  const trimmed = note?.trim().slice(0, 1000) || null;
  await prisma.milestone.update({
    where: { id: item.id },
    data: { clientRating: rating, clientRatingNote: trimmed, ratedAt: new Date() },
  });
  const firstName = viewer.user.firstName || "Client";
  later(() =>
    notifyAllAdmins({
      type: "MILESTONE_UPDATED",
      title: `${firstName} rated ${rating === 1 ? "👍" : "👎"}: ${item.title}`,
      body: trimmed ? `“${trimmed}”` : `on ${viewer.project.projectName}`,
      link: `/admin/projects/${item.projectId}`,
    }),
  );

  revalidateProject(item.projectId);
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
  // It leaves the client's "needs you" list once they've said they paid.
  revalidatePath("/portal/actions");
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin/invoices");
  return { ok: true };
}
