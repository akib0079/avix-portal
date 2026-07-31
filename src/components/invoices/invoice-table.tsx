"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  InvoiceStatusSelect,
  DeleteInvoiceButton,
} from "@/components/invoices/invoice-actions";
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
import { cn } from "@/lib/utils";
import { Search, Paperclip, FileText } from "lucide-react";
import type { InvoiceStatus } from "@prisma/client";

export type InvoiceListRow = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientId: string;
  projectName: string | null;
  issueDate: string;
  dueDate: string | null;
  amount: number;
  amountPaid: number;
  status: InvoiceStatus;
  hasDocument: boolean;
  paymentClaimed: boolean;
};

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

const FILTERS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
] as const;

/**
 * The invoice list with the two questions it never answered: who owes me, and
 * how late are they. Filtering and aging happen on the already-loaded rows —
 * the list is bounded server-side and this keeps it one round trip.
 */
export function InvoiceTable({
  invoices,
  now,
}: {
  invoices: InvoiceListRow[];
  /** Server-rendered timestamp — keeps "overdue" stable across re-renders. */
  now: number;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");

  const outstanding = invoices.map((i) => ({
    row: i,
    balance: Math.max(i.amount - i.amountPaid, 0),
  }));

  const aging = useMemo(() => {
    const totals: Record<Bucket, number> = { current: 0, d30: 0, d60: 0, d90: 0 };
    for (const { row, balance } of outstanding) {
      if (balance <= 0 || row.status === "CANCELLED") continue;
      totals[bucketOf(row, now)] += balance;
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, now]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return invoices.filter((i) => {
      const balance = Math.max(i.amount - i.amountPaid, 0);
      const overdue = !!i.dueDate && Date.parse(i.dueDate) < now && balance > 0;

      if (filter === "open" && (balance <= 0 || i.status === "CANCELLED")) return false;
      if (filter === "overdue" && !overdue) return false;
      if (filter === "paid" && i.status !== "PAID") return false;

      if (!needle) return true;
      return `${i.invoiceNumber} ${i.clientName} ${i.projectName ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, search, filter, now]);

  const totalOutstanding = aging.current + aging.d30 + aging.d60 + aging.d90;

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
                bucket === "d60" && aging[bucket] > 0 && "text-amber-600 dark:text-amber-400",
                bucket === "d90" && aging[bucket] > 0 && "text-red-600 dark:text-red-400",
              )}
            >
              {usd.format(aging[bucket])}
            </p>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search number, client or project"
                className="h-9 pl-8 text-sm"
              />
            </div>
            <div className="inline-flex rounded-lg border bg-card p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    filter === f.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {visible.length} of {invoices.length} · {usd.format(totalOutstanding)} outstanding
            </span>
          </div>

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
                {visible.map((invoice) => {
                  const balance = Math.max(invoice.amount - invoice.amountPaid, 0);
                  const overdue =
                    !!invoice.dueDate && Date.parse(invoice.dueDate) < now && balance > 0;
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <Link
                          href={`/admin/invoices/${invoice.id}`}
                          className="flex items-center gap-1.5 font-medium hover:text-primary"
                        >
                          {invoice.invoiceNumber}
                          {invoice.hasDocument && (
                            <Paperclip className="size-3 text-muted-foreground" />
                          )}
                          {invoice.paymentClaimed && invoice.status !== "PAID" && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                              Client says paid
                            </span>
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
                            ? "font-medium text-red-600 dark:text-red-400"
                            : "text-muted-foreground",
                        )}
                      >
                        {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {usd.format(invoice.amount)}
                      </TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {balance > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            {usd.format(balance)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusSelect
                          invoiceId={invoice.id}
                          status={invoice.status}
                        />
                      </TableCell>
                      <TableCell>
                        <DeleteInvoiceButton
                          invoiceId={invoice.id}
                          invoiceNumber={invoice.invoiceNumber}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
