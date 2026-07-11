"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/dal/session";
import { notifyAllAdmins } from "@/lib/dal/notifications";

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

  revalidatePath(`/portal/invoices/${id}`);
  revalidatePath("/portal/invoices");
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin/invoices");
  return { ok: true };
}
