"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@prisma/client";
import { deletePayment, createCreditNote } from "@/lib/actions/invoices";
import { balanceDue } from "@/lib/invoice-totals";
import { paymentBlocker } from "@/lib/invoice-rules";
import { RecordPaymentDialog } from "@/components/invoices/record-payment-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Loader2, Plus, Trash2, ReceiptText, Undo2 } from "lucide-react";
import { toneText } from "@/lib/tone";

export type PaymentRow = {
  id: string;
  amount: number;
  paidAt: string;
  method: string | null;
  note: string | null;
};

/**
 * Money received against one invoice. Before this, an invoice was either
 * "PAID" or not — a deposit had nowhere to go, so half-paid invoices were
 * either marked paid (wrong) or left looking unpaid (also wrong).
 *
 * Credit notes count against the balance too, so a credited invoice shows
 * what is really still owed.
 */
export function InvoicePayments({
  invoice,
  total,
  amountPaid,
  credited,
  currencySymbol,
  payments,
}: {
  invoice: {
    id: string;
    invoiceNumber: string;
    currency: string;
    status: InvoiceStatus;
    creditNoteForId: string | null;
  };
  total: number;
  amountPaid: number;
  /** Taken off by credit notes against this invoice. */
  credited: number;
  currencySymbol: string;
  payments: PaymentRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const balance = balanceDue(total, amountPaid, credited);
  const canTakePayment = paymentBlocker(invoice) === null;
  // A credit note is credited against nothing, and a draft or a void invoice
  // has nothing issued to credit.
  const canCredit =
    !invoice.creditNoteForId && invoice.status !== "DRAFT" && invoice.status !== "CANCELLED";

  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");

  const money = (value: number) =>
    `${currencySymbol}${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  async function submitCreditNote() {
    const value = Number(creditAmount);
    if (!(value > 0)) return void toast.error("Enter an amount above zero.");
    setBusy(true);
    const res = await createCreditNote(invoice.id, { amount: value, reason: creditReason });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    setCrediting(false);
    setCreditAmount("");
    setCreditReason("");
    toast.success("Credit note created.");
    router.push(`/admin/invoices/${res.data!.id}`);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading flex items-center gap-2 text-lg font-semibold">
            <ReceiptText className="size-4" /> Payments
          </h2>
          <div className="flex items-center gap-2">
            {canCredit && (
              <Button variant="outline" size="sm" onClick={() => setCrediting(true)}>
                <Undo2 className="size-3.5" /> Credit note
              </Button>
            )}
            {canTakePayment && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" /> Record payment
              </Button>
            )}
          </div>
        </div>

        <div
          className={cn(
            "mb-4 grid grid-cols-1 gap-3 text-sm",
            credited > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3",
          )}
        >
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Invoice total</p>
            <p className="font-heading mt-0.5 font-bold">{money(total)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Received</p>
            <p className="font-heading mt-0.5 font-bold text-emerald-600 dark:text-emerald-400">
              {money(amountPaid)}
            </p>
          </div>
          {credited > 0 && (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Credited</p>
              <p className="font-heading mt-0.5 font-bold">{money(credited)}</p>
            </div>
          )}
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Balance due</p>
            <p
              className={cn(
                "font-heading mt-0.5 font-bold",
                balance > 0 ? toneText.warn : "text-muted-foreground",
              )}
            >
              {money(balance)}
            </p>
          </div>
        </div>

        {payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {invoice.status === "DRAFT"
              ? "Still a draft. Payments can be recorded once it's sent."
              : "Nothing received yet."}
          </p>
        ) : (
          <ul className="space-y-2">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{money(p.amount)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(p.paidAt)}
                    {p.method ? ` · ${p.method}` : ""}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  aria-label="Remove payment"
                  onClick={async () => {
                    setBusy(true);
                    const res = await deletePayment(p.id);
                    setBusy(false);
                    if (!res.ok) return void toast.error(res.error);
                    // deletePayment revalidates this page; no refresh needed.
                    toast.success("Payment removed.");
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <RecordPaymentDialog
          target={adding ? { ...invoice, balance } : null}
          prefill="none"
          onClose={() => setAdding(false)}
        />

        <Dialog open={crediting} onOpenChange={setCrediting}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Issue a credit note</DialogTitle>
              <DialogDescription>
                Creates a separate CN document linked to this invoice, so the
                original stays on the record. The credit comes off what is
                still owed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Amount to credit</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Reason (optional)</span>
                <Input
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  placeholder="Scope reduced, goodwill, duplicate charge…"
                />
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCrediting(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submitCreditNote} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Create credit note
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
