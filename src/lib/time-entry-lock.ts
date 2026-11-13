/** An entry's invoice line, as the time-entry actions select it. */
export type BilledEntry = {
  invoiceItem: { invoice: { invoiceNumber: string; status: string } } | null;
};

/** The invoice an entry is billed on, when that invoice still counts. */
export function liveInvoice(entry: BilledEntry) {
  const invoice = entry.invoiceItem?.invoice;
  return invoice && invoice.status !== "CANCELLED" ? invoice : null;
}

/**
 * Billed hours are what an invoice charged for, so their hours and date
 * can't change under it (a cancelled invoice frees them). Staff are
 * money-blind: they are told the hours are locked, never by which invoice.
 */
export function lockedMessage(role: string, invoiceNumber: string, change: string): string {
  return role === "ADMIN"
    ? `These hours are billed on ${invoiceNumber}. Take them off that invoice, or cancel it, before ${change}.`
    : `These hours are locked. Ask an admin if they need ${change === "deleting them" ? "deleting" : "changing"}.`;
}

/**
 * Why a guarded write matched no row, told from the entry read beside it:
 * gone, billed on a live invoice, or (the invoice changed in between) neither.
 */
export function refusedChange(role: string, entry: BilledEntry | null, change: string): string {
  if (!entry) return "Time entry not found.";
  const invoice = liveInvoice(entry);
  if (invoice) return lockedMessage(role, invoice.invoiceNumber, change);
  return "These hours just changed. Reload the page and try again.";
}
