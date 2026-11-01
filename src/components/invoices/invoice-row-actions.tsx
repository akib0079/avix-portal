"use client";

import { useState } from "react";
import { cancelInvoice, deleteInvoice, sendInvoice } from "@/lib/actions/invoices";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { toPaymentTarget, type InvoiceListRow } from "./invoice-row";
import type { InvoiceRowAction } from "./invoice-row-menu";

type Confirming = { action: Exclude<InvoiceRowAction, "pay">; row: InvoiceListRow };

function copyFor({ action, row }: Confirming) {
  switch (action) {
    case "send":
      return {
        title: `${row.sent ? "Resend" : "Send"} ${row.invoiceNumber} to ${row.clientName}?`,
        body:
          row.status === "DRAFT"
            ? "It stops being a draft: the client gets it by email and can see it in their portal."
            : row.sent
              ? "They get the invoice by email again, with the PDF."
              : "The client gets the invoice by email, with the PDF.",
        label: row.sent ? "Resend" : "Send",
        destructive: false,
      };
    case "cancel":
      return {
        title: `Cancel ${row.invoiceNumber}?`,
        body: "It stays on record with its number and its history, struck through, and stops counting as owed. Nothing is emailed.",
        label: "Cancel invoice",
        destructive: true,
      };
    case "delete":
      return {
        title: `Delete ${row.invoiceNumber}?`,
        body: "It was never sent and has no payments, so it is removed completely, PDF included.",
        label: row.status === "DRAFT" ? "Delete draft" : "Delete",
        destructive: true,
      };
  }
}

/**
 * The dialogs behind every invoice row's menu, held once by the list rather
 * than once per row: the payment dialog, and a confirmation for anything that
 * emails a client or takes an invoice out of play. None of the actions needs
 * a router.refresh(); each revalidates the list itself.
 */
export function useInvoiceRowActions() {
  const [paying, setPaying] = useState<{
    row: InvoiceListRow;
    prefill: "balance" | "none";
  } | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [busy, setBusy] = useState(false);

  function run(action: InvoiceRowAction, row: InvoiceListRow) {
    if (action === "pay") setPaying({ row, prefill: "none" });
    else setConfirming({ action, row });
  }

  function pay(row: InvoiceListRow, prefill: "balance" | "none") {
    setPaying({ row, prefill });
  }

  async function confirm() {
    if (!confirming) return;
    const { action, row } = confirming;
    setBusy(true);
    const result =
      action === "send"
        ? await sendInvoice(row.id)
        : action === "cancel"
          ? await cancelInvoice(row.id)
          : await deleteInvoice(row.id);
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success(
      action === "send"
        ? `${row.invoiceNumber} emailed to ${row.clientName}.`
        : action === "cancel"
          ? `${row.invoiceNumber} cancelled.`
          : `${row.invoiceNumber} deleted.`,
    );
    setConfirming(null);
  }

  const text = confirming ? copyFor(confirming) : null;
  const dialogs = (
    <>
      <RecordPaymentDialog
        target={paying ? toPaymentTarget(paying.row) : null}
        prefill={paying?.prefill ?? "none"}
        onClose={() => setPaying(null)}
      />
      <Dialog open={!!confirming} onOpenChange={(open) => !open && !busy && setConfirming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{text?.title}</DialogTitle>
            <DialogDescription>{text?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
              Keep as is
            </Button>
            <Button
              variant={text?.destructive ? "destructive" : "default"}
              onClick={confirm}
              disabled={busy}
            >
              {busy && <Loader2 className="animate-spin" />}
              {text?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { run, pay, dialogs };
}
