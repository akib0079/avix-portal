import Link from "next/link";
import type { MilestoneView } from "@/components/milestones/milestone-types";
import { InvoiceStatusBadge } from "@/components/status-badges";
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
import { Clock, BadgeDollarSign, ReceiptText, Repeat } from "lucide-react";
import {
  BillWorkButton,
  LegacyNote,
  type BillableLineView,
} from "@/components/invoices/bill-work-button";
import { toneChip, toneText } from "@/lib/tone";
import { formatCurrency } from "@/lib/currency";
import { cadenceLabel, cadenceSuffix } from "@/lib/recurring";

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  issueDate: Date | string;
  amount: number;
  /** Money actually received — partial payments count toward "collected". */
  amountPaid: number;
  status: string;
};

type RetainerRow = {
  id: string;
  title: string;
  amount: number;
  currency: string;
  active: boolean;
  dayOfMonth: number;
  frequency: "WEEK" | "MONTH";
  interval: number;
};

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "good" | "warn";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </p>
      <p
        className={cn(
          "font-heading mt-1 text-xl font-bold",
          tone === "warn" && toneText.warn,
          tone === "good" && toneText.good,
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The money tab: what the work has earned, what has been billed, and what is
 * still owed — reconciled in one place. Previously "hours logged" and "invoices"
 * lived in separate cards that never compared themselves to each other.
 *
 * ADMIN only; STAFF never reaches this (getProject strips prices server-side).
 */
export function ProjectMoney({
  projectId,
  milestones,
  billingType,
  contractPrice,
  invoices,
  retainers,
  billable,
}: {
  projectId: string;
  milestones: MilestoneView[];
  billingType: "MILESTONE" | "CONTRACT";
  contractPrice: number | null;
  invoices: InvoiceRow[];
  retainers: RetainerRow[];
  /**
   * Work that could be billed right now, from getBillableWork. missingUsd:
   * contract projects' invoices with no USD value.
   */
  billable: {
    lines: BillableLineView[];
    total: number;
    unbilled: number;
    legacyUsd: number;
    missingUsd: number;
  };
}) {
  const totalLogged = milestones.reduce((sum, m) => sum + m.loggedHours, 0);
  const hourly = milestones.filter((m) => m.pricingType === "HOURLY");
  const totalEstimated = hourly.reduce((sum, m) => sum + (m.estimatedHours ?? 0), 0);

  // Earned = hourly work actually logged + fixed-price milestones completed.
  const earnedHourly = hourly.reduce(
    (sum, m) => sum + m.loggedHours * (m.hourlyRate ?? 0),
    0,
  );
  const earnedFixed = milestones
    .filter((m) => m.pricingType === "FIXED" && m.status === "COMPLETED")
    .reduce((sum, m) => sum + (m.fixedPrice ?? 0), 0);
  const earned =
    billingType === "CONTRACT" ? (contractPrice ?? 0) : earnedHourly + earnedFixed;
  // A contract with no price has nothing to compare; one with an invoice of
  // unknown USD value can't say what's left of it.
  const unpriced = billingType === "CONTRACT" && contractPrice == null;
  const unvalued = billingType === "CONTRACT" ? billable.missingUsd : 0;

  // Cancelled documents and credit notes never count as receivables.
  const liveInvoices = invoices.filter((i) => i.status !== "CANCELLED");
  const invoiced = liveInvoices.reduce((sum, i) => sum + i.amount, 0);
  const paid = liveInvoices.reduce((sum, i) => sum + i.amountPaid, 0);
  // Nor are drafts: nothing on one is owed until it has been sent.
  const outstanding = liveInvoices
    .filter((i) => i.status !== "DRAFT")
    .reduce((sum, i) => sum + i.amount - i.amountPaid, 0);
  // Work no invoice line bills yet, from the links between them, rather than
  // the work's value minus every invoice on the project.
  const unbilled = billable.unbilled;

  return (
    <div className="space-y-6">
      {billable.lines.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-brand-tint p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {billable.unbilled > 0
                ? `${usd.format(billable.unbilled)} of completed work isn't invoiced yet`
                : "Older invoices may already bill this work"}
            </p>
            <p className="text-xs text-muted-foreground">
              {billable.lines.length} line
              {billable.lines.length === 1 ? "" : "s"} no invoice bills yet — completed
              fixed-price work and logged hours.
            </p>
            {billable.legacyUsd > 0 && <LegacyNote legacyUsd={billable.legacyUsd} />}
          </div>
          <BillWorkButton
            projectId={projectId}
            lines={billable.lines}
            unbilled={billable.unbilled}
            legacyUsd={billable.legacyUsd}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Hours logged"
          value={fmtHours(totalLogged)}
          hint={
            billingType === "MILESTONE" && totalEstimated > 0
              ? `of ${fmtHours(totalEstimated)} estimated`
              : undefined
          }
          icon={Clock}
        />
        <Stat
          label={billingType === "CONTRACT" ? "Contract value" : "Earned"}
          value={unpriced ? "Not set" : usd.format(earned)}
          hint={
            unpriced ? undefined : unvalued > 0 ? (
              <Link href="/admin/invoices?filter=needs-usd" className="hover:text-primary">
                {unvalued} invoice{unvalued === 1 ? " has" : "s have"} no USD value, so what&apos;s
                left of the contract can&apos;t be worked out
              </Link>
            ) : unbilled > 0 ? (
              `${usd.format(unbilled)} not yet invoiced`
            ) : (
              "Fully invoiced"
            )
          }
          icon={BadgeDollarSign}
          tone={unbilled > 0 || unvalued > 0 ? "warn" : undefined}
        />
        <Stat
          label="Invoiced"
          value={usd.format(invoiced)}
          hint={`${liveInvoices.length} invoice${liveInvoices.length === 1 ? "" : "s"}`}
          icon={ReceiptText}
        />
        <Stat
          label="Outstanding"
          value={usd.format(outstanding)}
          hint={`${usd.format(paid)} collected`}
          icon={ReceiptText}
          tone={outstanding > 0 ? "warn" : "good"}
        />
      </div>

      {retainers.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="title-card mb-3 flex items-center gap-2">
              <Repeat className="size-4" /> Recurring
            </h3>
            <ul className="space-y-2">
              {retainers.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <span className="min-w-0">
                    <Link
                      href="/admin/retainers"
                      className="truncate text-sm font-medium hover:text-primary"
                    >
                      {r.title}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {r.frequency === "MONTH" && r.interval === 1
                        ? `Monthly, on day ${r.dayOfMonth}`
                        : cadenceLabel(r)}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-sm font-medium">
                      {formatCurrency(r.amount, r.currency)}
                      <span className="text-xs font-normal text-muted-foreground">
                        {cadenceSuffix(r)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium",
                        r.active
                          ? toneChip.good
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {r.active ? "Active" : "Paused"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <h3 className="title-card mb-3">
            Invoices ({invoices.length})
          </h3>
          {invoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No invoices linked to this project yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="hidden sm:table-cell">Issued</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <Link
                        href={`/admin/invoices/${invoice.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {formatDate(invoice.issueDate)}
                    </TableCell>
                    <TableCell className="text-sm">{usd.format(invoice.amount)}</TableCell>
                    <TableCell>
                      <InvoiceStatusBadge
                        status={invoice.status as Parameters<typeof InvoiceStatusBadge>[0]["status"]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
