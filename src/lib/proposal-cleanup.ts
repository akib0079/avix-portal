import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * What deleting a proposal tidies up after it: the draft invoice and the
 * silent client account it was provisioned with. Kept out of the "use
 * server" action files on purpose: an export there is a server action anyone
 * can call, and these take no session of their own.
 */

type Tx = Prisma.TransactionClient;

/**
 * Thrown inside a transaction to roll it back with a message for the user,
 * e.g. when a row changed between the check and the write.
 */
export class ActionAbort extends Error {}

/**
 * Removes the account a proposal created for its recipient while it is still
 * only that: never verified (the invite was never completed), never signed
 * in, and owning nothing. Callers check createdClientAccount first; this
 * checks everything else in the statement that deletes, so anything the
 * account gained in the meantime keeps it.
 */
export async function removeSilentClient(tx: Tx, userId: string, proposalId: string): Promise<boolean> {
  const otherProposals = await tx.proposal.count({
    where: { convertedClientId: userId, id: { not: proposalId } },
  });
  if (otherProposals > 0) return false;
  const removed = await tx.user.deleteMany({
    where: {
      id: userId,
      role: "CLIENT",
      emailVerified: false,
      sessions: { none: {} },
      invoices: { none: {} },
      projects: { none: {} },
      retainers: { none: {} },
      meetings: { none: {} },
      messages: { none: {} },
      clientMessages: { none: {} },
      taskRequests: { none: {} },
      imageUploads: { none: {} },
      tasksAbout: { none: {} },
      campaignRecipients: { none: {} },
    },
  });
  return removed.count > 0;
}

/**
 * Deletes the proposal's invoice only while it is still paperwork — the
 * statement form of draftInvoiceRemovable() in proposal-rules.ts, and the
 * line deleteInvoice draws, so a send, a payment, a credit note or the
 * client's "I've paid" that lands between the dialog and the click still wins.
 *
 * A recurring plan this invoice alone started goes with it, as in
 * deleteInvoice: left behind, it would go on billing a prospect who never
 * accepted anything. A plan with invoices of its own still copies it, so then
 * the invoice stays. `plans` is how many plans went.
 */
export async function removeDraftInvoice(
  tx: Tx,
  invoiceId: string,
): Promise<{ removed: boolean; plans: number }> {
  const paperwork = {
    status: { in: ["DRAFT", "ASSIGNED"] },
    sentAt: null,
    paymentClaimedAt: null,
    amountPaid: 0,
    payments: { none: {} },
    creditNotes: { none: {} },
  } satisfies Prisma.InvoiceWhereInput;
  const plans = await tx.retainer.deleteMany({
    where: {
      templateInvoiceId: invoiceId,
      templateInvoice: paperwork,
      invoices: { every: { id: invoiceId } },
    },
  });
  const removed = await tx.invoice.deleteMany({
    where: { id: invoiceId, ...paperwork, retainerTemplateFor: { none: {} } },
  });
  // A plan went but its template stayed: the invoice changed between the two.
  if (plans.count > 0 && removed.count === 0) {
    throw new ActionAbort("This invoice changed a moment ago. Refresh and try again.");
  }
  return { removed: removed.count > 0, plans: plans.count };
}
