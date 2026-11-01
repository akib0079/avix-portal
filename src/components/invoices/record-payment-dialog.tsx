"use client";

import { useState } from "react";
import type { InvoiceStatus } from "@prisma/client";
import { recordPayment, setInvoiceStatus } from "@/lib/actions/invoices";
import { paymentBlocker } from "@/lib/invoice-rules";
import { formatCurrency } from "@/lib/currency";
import { invoiceStatusLabels } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** The invoice a payment is being recorded against. */
export type PaymentTarget = {
  id: string;
  invoiceNumber: string;
  currency: string;
  status: InvoiceStatus;
  creditNoteForId?: string | null;
  /** What's still owed after payments and credit notes. */
  balance: number;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Money in, from wherever the owner is: the payments card, the row menu, the
 * status menu's "Paid" and a drop on the board's Paid lane. "Mark paid" opens
 * it with the balance filled in, so marking an invoice paid records the money
 * that made it so instead of only changing a label.
 *
 * A draft or a cancelled invoice takes no payments, so for those "Mark paid"
 * asks once and records the whole balance as one ("Marked paid") through
 * setInvoiceStatus, which moves it out of Draft or Cancelled on the way.
 *
 * Neither path calls router.refresh(): both actions revalidate the page.
 */
export function RecordPaymentDialog({
  target,
  prefill,
  onClose,
}: {
  target: PaymentTarget | null;
  /** "balance" for Mark paid; "none" leaves the amount for the owner to type. */
  prefill: "balance" | "none";
  onClose: () => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {/* Keyed, so each opening starts from fresh fields. */}
        {target && (
          <PaymentFields
            key={`${target.id}:${prefill}`}
            target={target}
            prefill={prefill}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaymentFields({
  target,
  prefill,
  onClose,
}: {
  target: PaymentTarget;
  prefill: "balance" | "none";
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(
    prefill === "balance" && target.balance > 0 ? String(target.balance) : "",
  );
  const [paidAt, setPaidAt] = useState(today);
  const [method, setMethod] = useState("");
  const money = (value: number) => formatCurrency(value, target.currency);
  const blocked = paymentBlocker(target);
  const value = Number(amount);
  const over = value > target.balance && target.balance > 0;

  async function markPaid() {
    setBusy(true);
    const res = await setInvoiceStatus(target.id, "PAID");
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`${target.invoiceNumber} marked paid.`);
    onClose();
  }

  async function submit() {
    if (!(value > 0)) return void toast.error("Enter an amount above zero.");
    setBusy(true);
    const res = await recordPayment(target.id, { amount: value, paidAt, method });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(
      value >= target.balance ? `${target.invoiceNumber} is paid in full.` : "Payment recorded.",
    );
    onClose();
  }

  // Drafts and cancelled invoices: no payment form, one confirmed step.
  if (blocked && !target.creditNoteForId && prefill === "balance") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Mark {target.invoiceNumber} paid?</DialogTitle>
          <DialogDescription>
            {target.status === "DRAFT" ? "It is still a draft." : "It is cancelled."} This
            records the {money(target.balance)} balance as received today and moves it from{" "}
            {invoiceStatusLabels[target.status]} to Paid.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Keep as is
          </Button>
          <Button onClick={markPaid} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Mark paid
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (blocked) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Can&apos;t record a payment</DialogTitle>
          <DialogDescription>{blocked}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {prefill === "balance" ? `Mark ${target.invoiceNumber} paid` : "Record a payment"}
        </DialogTitle>
        <DialogDescription>
          {target.balance > 0
            ? `${money(target.balance)} is still owed on ${target.invoiceNumber}. The status follows the money: part of it marks the invoice part paid.`
            : `Nothing is owed on ${target.invoiceNumber}; anything recorded now is extra.`}
        </DialogDescription>
      </DialogHeader>
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Amount ({target.currency})</span>
          <Input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={target.balance > 0 ? String(target.balance) : "0.00"}
          />
          {over && (
            <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">
              That is {money(Math.round((value - target.balance) * 100) / 100)} more than the
              balance. It will be recorded as overpaid.
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Date received</span>
          <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Method (optional)</span>
          <Input
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="Wise, bank transfer, cash…"
          />
        </label>
      </div>
      <DialogFooter className="mt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Record
        </Button>
      </DialogFooter>
    </form>
  );
}
