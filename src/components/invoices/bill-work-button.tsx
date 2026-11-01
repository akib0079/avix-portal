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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, ReceiptText } from "lucide-react";

export type BillableLineView = {
  /** "fixed:<milestone>", "hours:<milestone>" or "contract" (lib/billable-lines). */
  key: string;
  description: string;
  qty: number;
  rate: number;
};

function lineTotal(line: BillableLineView): number {
  return Math.round(line.qty * line.rate * 100) / 100;
}

/**
 * Turns the project's priced work that no invoice bills yet into a draft
 * invoice. The lines are shown before anything is created, each with a tick
 * box, so this invoice can bill some of the work and leave the rest for the
 * next one. What it bills is linked to it and won't be offered again unless
 * the invoice is cancelled.
 */
export function BillWorkButton({
  projectId,
  lines,
  unbilled,
}: {
  projectId: string;
  lines: BillableLineView[];
  /** Value of the work no invoice bills yet (USD). */
  unbilled: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [taxRate, setTaxRate] = useState("");
  const [taxLabel, setTaxLabel] = useState("");
  const [terms, setTerms] = useState<string>("14");

  const chosen = lines.filter((line) => picked.has(line.key));
  const subtotal = Math.round(chosen.reduce((sum, line) => sum + lineTotal(line), 0) * 100) / 100;
  const allPicked = chosen.length === lines.length;

  function show() {
    // Everything ticked to start with: most invoices bill all of it.
    setPicked(new Set(lines.map((line) => line.key)));
    setOpen(true);
  }

  function toggle(key: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function generate() {
    setBusy(true);
    const res = await createInvoiceFromWork(projectId, {
      lines: chosen.map((line) => line.key),
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
      <Button size="sm" onClick={show} disabled={lines.length === 0}>
        <ReceiptText className="size-3.5" />
        {unbilled > 0 ? `Bill ${usd.format(unbilled)} of work` : "Bill this work"}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Draft an invoice from this work</DialogTitle>
            <DialogDescription>
              Completed fixed-price work and hours no invoice bills yet. Untick anything to
              leave it for a later invoice. It saves as a draft — nothing is sent.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
              <span>
                {chosen.length} of {lines.length} line{lines.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() =>
                  setPicked(allPicked ? new Set() : new Set(lines.map((line) => line.key)))
                }
              >
                {allPicked ? "Untick all" : "Tick all"}
              </button>
            </div>
            <ul className="divide-y text-sm">
              {lines.map((line) => {
                const on = picked.has(line.key);
                return (
                  <li key={line.key}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                        checked={on}
                        onChange={() => toggle(line.key)}
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 [overflow-wrap:anywhere]",
                          !on && "text-muted-foreground line-through decoration-1",
                        )}
                      >
                        {line.description}
                        <span className="block text-xs text-muted-foreground">
                          {line.qty} × {usd.format(line.rate)}
                        </span>
                      </span>
                      <span className={cn("shrink-0 tabular-nums", !on && "text-muted-foreground")}>
                        {usd.format(lineTotal(line))}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between border-t px-3 py-2 text-sm font-medium">
              <span>Subtotal</span>
              <span className="tabular-nums">{usd.format(subtotal)}</span>
            </div>
          </div>

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
            <Button onClick={generate} disabled={busy || chosen.length === 0}>
              {busy && <Loader2 className="animate-spin" />} Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
