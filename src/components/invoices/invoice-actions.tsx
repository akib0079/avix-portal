"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@prisma/client";
import {
  cancelInvoice,
  deleteInvoice,
  sendInvoice,
  setInvoiceStatus,
} from "@/lib/actions/invoices";
import { invoiceStatusLabels } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { LazySelect } from "@/components/ui/lazy-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Ban, Send, Trash2, Loader2 } from "lucide-react";

const STATUS_OPTIONS = (Object.keys(invoiceStatusLabels) as InvoiceStatus[]).map((value) => ({
  value,
  label: invoiceStatusLabels[value],
}));

/**
 * Row-level status control. Moves the moment you pick — the old version sat
 * on the previous status through the save AND a second full-page refresh.
 * useOptimistic reverts on its own if the save fails. No router.refresh():
 * setInvoiceStatus calls revalidatePath, so the fresh page already comes
 * back in the action's own response.
 *
 * Paid and Part paid are money, not labels: with a balance owing they open
 * the payment dialog (onPay) rather than flipping the status, so amountPaid
 * and the badge can't disagree.
 */
export function InvoiceStatusSelect({
  invoiceId,
  status,
  balance,
  onPay,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  /** What's still owed; with nothing owed, Paid is just a status change. */
  balance: number;
  onPay: (prefill: "balance" | "none") => void;
}) {
  const [shown, setShown] = useOptimistic(status);
  const [, startTransition] = useTransition();

  return (
    <LazySelect
      value={shown}
      options={STATUS_OPTIONS}
      ariaLabel="Invoice status"
      className="w-[120px]"
      onValueChange={(value) => {
        if (value === shown) return;
        if (balance > 0 && (value === "PAID" || value === "PARTIALLY_PAID")) {
          onPay(value === "PAID" ? "balance" : "none");
          return;
        }
        startTransition(async () => {
          setShown(value);
          const result = await setInvoiceStatus(invoiceId, value);
          if (!result.ok) toast.error(result.error);
        });
      }}
    />
  );
}

export function SendInvoiceButton({
  invoiceId,
  clientEmail,
  sent = false,
  size = "sm",
}: {
  invoiceId: string;
  clientEmail: string;
  /** Already emailed once: the button says Resend. */
  sent?: boolean;
  size?: "sm" | "default";
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size={size}
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await sendInvoice(invoiceId);
        setBusy(false);
        if (!result.ok) return void toast.error(result.error);
        // sendInvoice revalidates the page; a refresh would render it twice.
        toast.success(`Invoice emailed to ${clientEmail}.`);
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Send />}
      {sent ? "Resend" : "Send to client"}
    </Button>
  );
}

/**
 * The invoice page's way out: Delete for an untouched draft, Cancel (void)
 * for anything that was sent, paid or credited, which keeps its number and
 * history. The server applies the same rule (canDeleteInvoice), so this only
 * decides which button to show.
 */
export function RemoveInvoiceButton({
  invoiceId,
  invoiceNumber,
  deletable,
  cancelled,
}: {
  invoiceId: string;
  invoiceNumber: string;
  deletable: boolean;
  cancelled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!deletable && cancelled) return null;

  async function confirm() {
    setBusy(true);
    const result = deletable ? await deleteInvoice(invoiceId) : await cancelInvoice(invoiceId);
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    setOpen(false);
    if (deletable) {
      toast.success(`${invoiceNumber} deleted.`);
      // The page it was on is gone; the list is revalidated by the action.
      router.push("/admin/invoices");
    } else {
      toast.success(`${invoiceNumber} cancelled.`);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        {deletable ? <Trash2 /> : <Ban />}
        {deletable ? "Delete" : "Cancel"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deletable ? `Delete ${invoiceNumber}?` : `Cancel ${invoiceNumber}?`}
            </DialogTitle>
            <DialogDescription>
              {deletable
                ? "It was never sent and has no payments, so it is removed completely, PDF included. This can't be undone."
                : "It stays on record with its number and its history, struck through, and stops counting as owed. Nothing is emailed."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={busy} onClick={confirm}>
              {busy && <Loader2 className="animate-spin" />}
              {deletable ? "Delete invoice" : "Cancel invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
