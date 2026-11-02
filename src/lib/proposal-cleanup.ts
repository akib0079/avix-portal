import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * What deleting a proposal tidies up after it: the draft invoice and the
 * silent client account it was provisioned with. Shared by deleteProposal,
 * the builder's recipient move and deleteLead, and kept out of the "use
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
 * statement form of draftInvoiceRemovable() in proposal-rules.ts, so a send or
 * a payment that lands between the dialog and the click still wins.
 */
export async function removeDraftInvoice(tx: Tx, invoiceId: string): Promise<boolean> {
  const removed = await tx.invoice.deleteMany({
    where: {
      id: invoiceId,
      status: { in: ["DRAFT", "ASSIGNED"] },
      sentAt: null,
      amountPaid: 0,
      payments: { none: {} },
    },
  });
  return removed.count > 0;
}
