"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@prisma/client";
import {
  setInvoiceStatus,
  sendInvoice,
  deleteInvoice,
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
import { Send, Trash2, Loader2 } from "lucide-react";

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

export function DeleteInvoiceButton({
  invoiceId,
  invoiceNumber,
  redirectAfterDelete,
}: {
  invoiceId: string;
  invoiceNumber: string;
  redirectAfterDelete?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
        <span className="sr-only">Delete invoice</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete invoice {invoiceNumber}?</DialogTitle>
            <DialogDescription>
              This permanently removes the invoice and its PDF. This can&apos;t
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await deleteInvoice(invoiceId);
                setBusy(false);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Invoice deleted.");
                setOpen(false);
                if (redirectAfterDelete) router.push(redirectAfterDelete);
                router.refresh();
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              Delete invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
