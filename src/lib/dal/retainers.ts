import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

/** Serialized retainer safe for client components. */
export type RetainerView = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  projectId: string | null;
  projectName: string | null;
  amount: number;
  dayOfMonth: number;
  active: boolean;
  lastGeneratedPeriod: string | null;
  notes: string | null;
  /** Invoices linked to this plan (generated or attached), newest first. */
  invoices: RetainerInvoice[];
  /** Client's invoices not yet linked to any retainer — for the attach picker. */
  attachable: RetainerInvoice[];
};

export type RetainerInvoice = {
  id: string;
  invoiceNumber: string;
  amount: number;
  status: string;
  issueDate: string;
};

export async function listRetainers(): Promise<RetainerView[]> {
  await requireAdmin();
  const rows = await prisma.retainer.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    include: {
      client: { select: { firstName: true, lastName: true } },
      project: { select: { projectName: true } },
      invoices: {
        orderBy: { issueDate: "desc" },
        select: { id: true, invoiceNumber: true, amount: true, status: true, issueDate: true },
      },
    },
  });

  // Unlinked invoices per client, so each row can offer an "attach existing" list.
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  const unlinked = clientIds.length
    ? await prisma.invoice.findMany({
        where: { clientId: { in: clientIds }, retainerId: null },
        orderBy: { issueDate: "desc" },
        take: 200,
        select: {
          id: true,
          clientId: true,
          invoiceNumber: true,
          amount: true,
          status: true,
          issueDate: true,
        },
      })
    : [];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    clientId: r.clientId,
    clientName: `${r.client.firstName} ${r.client.lastName}`.trim() || "Client",
    projectId: r.projectId,
    projectName: r.project?.projectName ?? null,
    amount: Number(r.amount),
    dayOfMonth: r.dayOfMonth,
    active: r.active,
    lastGeneratedPeriod: r.lastGeneratedPeriod,
    notes: r.notes,
    invoices: r.invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      amount: Number(i.amount),
      status: i.status,
      issueDate: i.issueDate.toISOString(),
    })),
    attachable: unlinked
      .filter((i) => i.clientId === r.clientId)
      .map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        amount: Number(i.amount),
        status: i.status,
        issueDate: i.issueDate.toISOString(),
      })),
  }));
}
