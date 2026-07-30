"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { retainerSchema, type RetainerInput } from "@/lib/validation/retainer";
import { nextInvoiceNumber } from "@/lib/invoice-number";
import { logActivity } from "@/lib/dal/activity";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type NormalizeResult =
  | { error: string; values?: never }
  | {
      error?: never;
      values: {
        title: string;
        clientId: string;
        projectId: string | null;
        amount: number;
        dayOfMonth: number;
        active: boolean;
        notes: string | null;
      };
    };

async function normalize(data: RetainerInput): Promise<NormalizeResult> {
  const client = await prisma.user.findFirst({
    where: { id: data.clientId, role: "CLIENT" },
    select: { id: true },
  });
  if (!client) return { error: "Client not found." };

  let projectId: string | null = null;
  if (data.projectId !== "none") {
    const project = await prisma.project.findFirst({
      where: { id: data.projectId, clientId: client.id },
      select: { id: true },
    });
    if (!project) return { error: "Project not found for that client." };
    projectId = project.id;
  }

  return {
    values: {
      title: data.title,
      clientId: client.id,
      projectId,
      amount: data.amount,
      dayOfMonth: data.dayOfMonth,
      active: data.active,
      notes: data.notes || null,
    },
  };
}

export async function createRetainer(input: RetainerInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = retainerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const result = await normalize(parsed.data);
  if (result.error !== undefined) return { ok: false, error: result.error };

  await prisma.retainer.create({ data: result.values });
  revalidatePath("/admin/retainers");
  return { ok: true };
}

export async function updateRetainer(
  id: string,
  input: RetainerInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = retainerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const existing = await prisma.retainer.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Retainer not found." };

  const result = await normalize(parsed.data);
  if (result.error !== undefined) return { ok: false, error: result.error };

  await prisma.retainer.update({ where: { id }, data: result.values });
  revalidatePath("/admin/retainers");
  return { ok: true };
}

/**
 * Draft this month's invoice for a retainer NOW, instead of waiting for the
 * duties engine to reach its bill-on day. Same shape as the automatic draft
 * (ASSIGNED, 14-day terms, one line item) and it stamps lastGeneratedPeriod so
 * the scheduled run won't duplicate it.
 */
export async function generateRetainerInvoice(
  id: string,
): Promise<ActionResult<{ invoiceId: string; invoiceNumber: string }>> {
  await requireAdmin();
  const retainer = await prisma.retainer.findUnique({ where: { id } });
  if (!retainer) return { ok: false, error: "Retainer not found." };

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (retainer.lastGeneratedPeriod === period) {
    return {
      ok: false,
      error: "This month's invoice was already generated for this retainer.",
    };
  }

  const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  const created = await prisma.$transaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(tx);
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        clientId: retainer.clientId,
        projectId: retainer.projectId,
        retainerId: retainer.id,
        amount: retainer.amount,
        status: "ASSIGNED",
        issueDate: now,
        dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
        title: `${retainer.title} — ${monthLabel}`,
        notes: `${retainer.title} — ${monthLabel}${retainer.notes ? `\n${retainer.notes}` : ""}`,
        items: {
          create: [
            {
              description: `${retainer.title} — ${monthLabel}`,
              qty: 1,
              rate: retainer.amount,
              sortOrder: 0,
            },
          ],
        },
      },
      select: { id: true, invoiceNumber: true },
    });
    await tx.retainer.update({
      where: { id: retainer.id },
      data: { lastGeneratedPeriod: period },
    });
    return invoice;
  });

  await logActivity({
    type: "invoice.drafted",
    summary: `Retainer invoice ${created.invoiceNumber} drafted — ${retainer.title}`,
    clientId: retainer.clientId,
    entity: "invoice",
    entityId: created.id,
    link: `/admin/invoices/${created.id}`,
  });

  revalidatePath("/admin/retainers");
  revalidatePath("/admin/invoices");
  return {
    ok: true,
    data: { invoiceId: created.id, invoiceNumber: created.invoiceNumber },
  };
}

/**
 * Attach an EXISTING invoice to a retainer — the "add" half of add-or-generate.
 * Only invoices belonging to the retainer's own client can be linked, so a plan
 * can never claim another client's money.
 */
export async function attachInvoiceToRetainer(
  retainerId: string,
  invoiceId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const retainer = await prisma.retainer.findUnique({
    where: { id: retainerId },
    select: { id: true, clientId: true, title: true },
  });
  if (!retainer) return { ok: false, error: "Retainer not found." };

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, clientId: retainer.clientId },
    select: { id: true, invoiceNumber: true, retainerId: true },
  });
  if (!invoice) {
    return { ok: false, error: "Invoice not found for this retainer's client." };
  }
  if (invoice.retainerId && invoice.retainerId !== retainerId) {
    return { ok: false, error: "That invoice is already linked to another retainer." };
  }

  await prisma.invoice.update({ where: { id: invoice.id }, data: { retainerId } });
  revalidatePath("/admin/retainers");
  revalidatePath("/admin/invoices");
  return { ok: true };
}

/** Unlink an invoice from its retainer (the invoice itself is untouched). */
export async function detachInvoiceFromRetainer(invoiceId: string): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true },
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };

  await prisma.invoice.update({ where: { id: invoiceId }, data: { retainerId: null } });
  revalidatePath("/admin/retainers");
  revalidatePath("/admin/invoices");
  return { ok: true };
}

export async function deleteRetainer(id: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await prisma.retainer.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Retainer not found." };

  await prisma.retainer.delete({ where: { id } });
  revalidatePath("/admin/retainers");
  return { ok: true };
}
