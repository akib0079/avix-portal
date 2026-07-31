"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createInvoiceFromWork } from "@/lib/actions/invoices";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { paymentTermsOptions } from "@/lib/validation/invoice";
import { usd } from "@/lib/format";
import { toast } from "sonner";
import { Loader2, ReceiptText } from "lucide-react";

export type BillableLineView = {
  description: string;
  qty: number;
  rate: number;
};

/**
 * Turns the project's completed priced work into a draft invoice. The lines
 * are shown before anything is created, because the fix for "I have to retype
 * the milestone board into an invoice" still has to be reviewable.
 */
export function BillWorkButton({
  projectId,
  lines,
  total,
  unbilled,
}: {
  projectId: string;
  lines: BillableLineView[];
  total: number;
  unbilled: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taxRate, setTaxRate] = useState("");
  const [taxLabel, setTaxLabel] = useState("");
  const [terms, setTerms] = useState<string>("14");

  async function generate() {
    setBusy(true);
    const res = await createInvoiceFromWork(projectId, {
      taxRate: taxRate === "" ? null : Number(taxRate),
      taxLabel: taxLabel || undefined,
      paymentTermsDays: terms === "none" ? null : Number(terms),
    });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Draft invoice created.");
    router.push(`/admin/invoices/${res.data!.id}`);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={lines.length === 0}>
        <ReceiptText className="size-3.5" />
        {unbilled > 0 ? `Bill ${usd.format(unbilled)} of work` : "Bill this work"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Draft an invoice from this work</DialogTitle>
            <DialogDescription>
              Completed fixed-price milestones and logged hourly time become
              line items. It saves as a draft — nothing is sent.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-1.5 rounded-lg border p-3 text-sm">
            {lines.map((line, i) => (
              <li key={i} className="flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {line.description}
                </span>
                <span className="shrink-0">
                  {line.qty} × {usd.format(line.rate)}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between border-t pt-2 font-medium">
              <span>Total</span>
              <span>{usd.format(total)}</span>
            </li>
          </ul>

          {unbilled < total && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {usd.format(total - unbilled)} of this has already been invoiced on
              this project — edit the draft before sending if it overlaps.
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Tax label</span>
              <Input
                value={taxLabel}
                onChange={(e) => setTaxLabel(e.target.value)}
                placeholder="VAT"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Tax %</span>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Terms</span>
              <Select value={terms} onValueChange={setTerms}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No terms</SelectItem>
                  {paymentTermsOptions.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {days === 0 ? "On receipt" : `Net ${days}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
