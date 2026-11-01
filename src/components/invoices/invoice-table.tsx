"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { InvoiceStatusSelect } from "@/components/invoices/invoice-actions";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usd, formatDate } from "@/lib/format";
import { formatCurrency } from "@/lib/currency";
import { usdValue } from "@/lib/invoice-usd";
import { ShowMore, useProgressive } from "@/components/ui/progressive";
import { ViewToggle, VIEW_MODES } from "@/components/ui/lanes";
import { todayKey } from "@/components/board/board-bits";
import { useLocalChoice } from "@/lib/use-local-pref";
import { InvoiceLanes } from "./invoice-lanes";
import {
  INVOICE_FILTERS,
  isRecurring,
  needsUsd,
  rowBalance,
  type InvoiceFilter,
  type InvoiceListRow,
} from "./invoice-row";
import { InvoiceRowMenu } from "./invoice-row-menu";
import { useInvoiceRowActions } from "./invoice-row-actions";
import { isReceivable } from "@/lib/invoice-rules";
import { cn } from "@/lib/utils";
import { Search, Paperclip, FileText } from "lucide-react";
import { RepeatMark } from "./repeat-mark";
import { toneText } from "@/lib/tone";
import { SoftPill } from "@/components/ui/status-pill";
import { HUE } from "@/lib/status-colors";

/** Receivables age from the due date; undated invoices sit in "Current". */
type Bucket = "current" | "d30" | "d60" | "d90";

const BUCKET_LABEL: Record<Bucket, string> = {
  current: "Not yet due",
  d30: "1–30 days",
  d60: "31–60 days",
  d90: "60+ days",
};

function bucketOf(row: InvoiceListRow, now: number): Bucket {
  if (!row.dueDate) return "current";
  const days = Math.floor((now - Date.parse(row.dueDate)) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  return "d90";
}

/**
 * The invoice list with the two questions it never answered: who owes me, and
 * how late are they. Filtering and aging happen on the already-loaded rows —
 * the list is bounded server-side and this keeps it one round trip.
 */
export function InvoiceTable({
  invoices,
  now,
  initialFilter = "all",
}: {
  invoices: InvoiceListRow[];
  /** Server-rendered timestamp — keeps "overdue" stable across re-renders. */
  now: number;
  /** From ?filter=, so the dashboard's "set them" link lands on the right rows. */
  initialFilter?: InvoiceFilter;
}) {
  const [view, setView] = useLocalChoice("avix.invoices.view", "list", VIEW_MODES);
  const [today] = useState(todayKey);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InvoiceFilter>(initialFilter);
  const missingUsd = useMemo(() => invoices.filter(needsUsd).length, [invoices]);

  // One set of dialogs for the whole list, opened by a row's status menu, its
  // "…" menu, or a drop on the board.
  const actions = useInvoiceRowActions();

  // Aging is in USD: a balance is converted at the invoice's own recorded
  // USD value, and one without a USD value yet is left out rather than
  // added at face value (EUR 1,400 is not $1,400). Only receivables age:
  // drafts, void invoices and credit notes are nobody's debt.
  const aging = useMemo(() => {
    const totals: Record<Bucket, number> = { current: 0, d30: 0, d60: 0, d90: 0 };
    for (const row of invoices) {
      const balance = rowBalance(row);
      if (balance <= 0 || !isReceivable(row)) continue;
      // usdValue covers a USD invoice whose amountUsd was never filled in.
      const worth = usdValue(row);
      if (worth === null || row.amount <= 0) continue;
      totals[bucketOf(row, now)] += balance * (worth / row.amount);
    }
    return totals;
  }, [invoices, now]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return invoices.filter((i) => {
      const balance = rowBalance(i);
      const owed = balance > 0 && isReceivable(i);
      const overdue = owed && !!i.dueDate && Date.parse(i.dueDate) < now;

      if (filter === "open" && !owed) return false;
      if (filter === "overdue" && !overdue) return false;
      if (filter === "paid" && i.status !== "PAID") return false;
      if (filter === "draft" && i.status !== "DRAFT") return false;
      if (filter === "recurring" && !isRecurring(i)) return false;
      if (filter === "needs-usd" && !needsUsd(i)) return false;

      if (!needle) return true;
      return `${i.invoiceNumber} ${i.clientName} ${i.projectName ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [invoices, search, filter, now]);

  const totalOutstanding = aging.current + aging.d30 + aging.d60 + aging.d90;
  const page = useProgressive(visible, `${filter}|${search}`);

  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <FileText className="size-6 text-muted-foreground" />
            </div>
            <p className="mt-4 font-medium">No invoices yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first invoice to start billing.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Aging — what's owed and how stale it is. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(BUCKET_LABEL) as Bucket[]).map((bucket) => (
          <div
            key={bucket}
            className={cn(
              "rounded-xl border bg-card p-3",
              bucket === "d90" && aging[bucket] > 0 && "border-red-300 dark:border-red-900",
            )}
          >
            <p className="text-xs text-muted-foreground">{BUCKET_LABEL[bucket]}</p>
            <p
              className={cn(
                "font-heading mt-0.5 text-lg font-bold",
                bucket === "d60" && aging[bucket] > 0 && toneText.warn,
                bucket === "d90" && aging[bucket] > 0 && toneText.bad,
              )}
            >
              {usd.format(aging[bucket])}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number, client or project"
            className="h-9 bg-card pl-8 text-sm"
          />
        </div>
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg border bg-card p-0.5">
          {INVOICE_FILTERS.map((f) =>
            // Only offered when there is something to fix (or it is the view).
            f.value === "needs-usd" && missingUsd === 0 && filter !== f.value ? null : (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  filter === f.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                  f.value === "needs-usd" &&
                    filter !== f.value &&
                    "text-amber-700 dark:text-amber-300",
                )}
              >
                {f.label}
                {f.value === "needs-usd" && missingUsd > 0 && ` · ${missingUsd}`}
              </button>
            ),
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {visible.length} of {invoices.length} · {usd.format(totalOutstanding)} outstanding
        </span>
        <ViewToggle value={view} onChange={setView} className="ml-auto" />
      </div>

      {view === "board" && visible.length > 0 ? (
        <InvoiceLanes
          invoices={visible}
          now={now}
          today={today}
          onPay={actions.pay}
          onAction={actions.run}
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            {visible.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nothing matches those filters.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="hidden md:table-cell">Client</TableHead>
                    <TableHead className="hidden lg:table-cell">Project</TableHead>
                    <TableHead className="hidden sm:table-cell">Due</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="hidden sm:table-cell">Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.shown.map((invoice) => {
                    const balance = rowBalance(invoice);
                    const overdue =
                      isReceivable(invoice) &&
                      !!invoice.dueDate &&
                      Date.parse(invoice.dueDate) < now &&
                      balance > 0;
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell>
                          <Link
                            href={`/admin/invoices/${invoice.id}`}
                            className="flex items-center gap-1.5 font-medium hover:text-primary"
                          >
                            {invoice.invoiceNumber}
                            {isRecurring(invoice) && <RepeatMark row={invoice} />}
                            {invoice.hasDocument && (
                              <Paperclip className="size-3 text-muted-foreground" />
                            )}
                            {invoice.paymentClaimed && invoice.status !== "PAID" && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                Client says paid
                              </span>
                            )}
                            {invoice.creditNoteForId && (
                              <SoftPill color={HUE.violet} className="text-[10px]">
                                Credit note
                              </SoftPill>
                            )}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                          <Link
                            href={`/admin/clients/${invoice.clientId}`}
                            className="hover:text-primary"
                          >
                            {invoice.clientName}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                          {invoice.projectName ?? "—"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "hidden text-sm sm:table-cell",
                            overdue
                              ? cn("font-medium", toneText.bad)
                              : "text-muted-foreground",
                          )}
                        >
                          {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {formatCurrency(invoice.amount, invoice.currency)}
                        </TableCell>
                        <TableCell className="hidden text-sm sm:table-cell">
                          {balance > 0 ? (
                            <span className={toneText.warn}>
                              {formatCurrency(balance, invoice.currency)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <InvoiceStatusSelect
                            invoiceId={invoice.id}
                            status={invoice.status}
                            balance={balance}
                            onPay={(prefill) => actions.pay(invoice, prefill)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <InvoiceRowMenu row={invoice} onAction={actions.run} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            <ShowMore remaining={page.remaining} step={page.step} onShowMore={page.showMore} />
          </CardContent>
        </Card>
      )}

      {actions.dialogs}
    </div>
  );
}
