"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordPayment, deletePayment, createCreditNote } from "@/lib/actions/invoices";
import { balanceDue } from "@/lib/invoice-totals";
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
 */
export function InvoicePayments({
  invoiceId,
  total,
  amountPaid,
  currencySymbol,
  payments,
}: {
  invoiceId: string;
  total: number;
  amountPaid: number;
  currencySymbol: string;
  payments: PaymentRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const balance = balanceDue(total, amountPaid);

  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");

  const money = (value: number) =>
    `${currencySymbol}${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  async function submitPayment() {
    const value = Number(amount);
    if (!(value > 0)) return void toast.error("Enter an amount above zero.");
    setBusy(true);
    const res = await recordPayment(invoiceId, { amount: value, paidAt, method });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    setAdding(false);
    setAmount("");
    setMethod("");
    toast.success("Payment recorded.");
    router.refresh();
  }

  async function submitCreditNote() {
    const value = Number(creditAmount);
    if (!(value > 0)) return void toast.error("Enter an amount above zero.");
    setBusy(true);
    const res = await createCreditNote(invoiceId, { amount: value, reason: creditReason });
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
            <Button variant="outline" size="sm" onClick={() => setCrediting(true)}>
              <Undo2 className="size-3.5" /> Credit note
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Record payment
            </Button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
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
            Nothing received yet.
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
                    toast.success("Payment removed.");
                    router.refresh();
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record a payment</DialogTitle>
              <DialogDescription>
                The invoice status follows the money — part pays mark it as
                partially paid.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Amount</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={balance > 0 ? String(balance) : "0.00"}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Date received</span>
                <Input
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
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
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdding(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submitPayment} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Record
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={crediting} onOpenChange={setCrediting}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Issue a credit note</DialogTitle>
              <DialogDescription>
                Creates a separate CN document linked to this invoice, so the
                original stays on the record.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Amount to credit</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
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
