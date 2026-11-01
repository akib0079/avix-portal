"use client";

import { useState } from "react";
import Link from "next/link";
import { paymentBlocker, sendBlocker } from "@/lib/invoice-rules";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Ban,
  Copy,
  Download,
  ExternalLink,
  HandCoins,
  MoreHorizontal,
  Send,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { rowBalance, type InvoiceListRow } from "./invoice-row";

/** What a row's menu asks its list to do; the list owns the dialogs. */
export type InvoiceRowAction = "send" | "pay" | "cancel" | "delete";

/** Where the invoice's document opens: the file the owner supplied, or the generated PDF. */
function documentHref(row: InvoiceListRow) {
  return row.hasDocument ? `/api/files/invoice/${row.id}` : `/api/invoices/${row.id}/pdf`;
}

/**
 * The "…" on an invoice row or board card: everything you do to an invoice
 * without opening it. Only what the invoice allows right now is offered, by
 * the same rules the server enforces (lib/invoice-rules).
 *
 * Like LazySelect, it renders a plain button until first reached for: a list
 * of 300 Radix menus has to hydrate before the page responds, and one is
 * enough. Pointer and key events stop here so a board card doesn't start a
 * drag from its own menu button.
 */
export function InvoiceRowMenu({
  row,
  onAction,
  className,
}: {
  row: InvoiceListRow;
  onAction: (action: InvoiceRowAction, row: InvoiceListRow) => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const triggerClass = cn(
    "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
    className,
  );
  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onTouchStart: (e: React.TouchEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  };

  if (!armed) {
    return (
      <span {...stop} className="contents">
        <button
          type="button"
          aria-label={`Actions for ${row.invoiceNumber}`}
          aria-haspopup="menu"
          className={triggerClass}
          onPointerDown={(e) => {
            if (e.button === 0) setArmed(true);
          }}
          onKeyDown={(e) => {
            if (["Enter", " ", "ArrowDown"].includes(e.key)) {
              e.preventDefault();
              setArmed(true);
            }
          }}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </span>
    );
  }

  const canSend = sendBlocker(row) === null;
  const canPay = paymentBlocker(row) === null && rowBalance(row) > 0;
  const canCancel = !row.deletable && row.status !== "CANCELLED";

  return (
    <span {...stop} className="contents">
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger
          aria-label={`Actions for ${row.invoiceNumber}`}
          className={triggerClass}
          autoFocus
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link href={`/admin/invoices/${row.id}`}>
              <SquareArrowOutUpRight /> Open
            </Link>
          </DropdownMenuItem>
          {!row.creditNoteForId && (
            <DropdownMenuItem asChild>
              <Link href={`/admin/invoices/new?from=${row.id}`}>
                <Copy /> Duplicate
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a href={documentHref(row)} target="_blank" rel="noopener noreferrer">
              {row.suppliedLink ? <ExternalLink /> : <Download />}
              {row.suppliedLink ? "View document" : "Download PDF"}
            </a>
          </DropdownMenuItem>
          {(canSend || canPay) && <DropdownMenuSeparator />}
          {canSend && (
            <DropdownMenuItem onSelect={() => onAction("send", row)}>
              <Send /> {row.sent ? "Resend to client" : "Send to client"}
            </DropdownMenuItem>
          )}
          {canPay && (
            <DropdownMenuItem onSelect={() => onAction("pay", row)}>
              <HandCoins /> Record payment
            </DropdownMenuItem>
          )}
          {(canCancel || row.deletable) && <DropdownMenuSeparator />}
          {canCancel && (
            <DropdownMenuItem variant="destructive" onSelect={() => onAction("cancel", row)}>
              <Ban /> Cancel (void)
            </DropdownMenuItem>
          )}
          {row.deletable && (
            <DropdownMenuItem variant="destructive" onSelect={() => onAction("delete", row)}>
              <Trash2 /> {row.status === "DRAFT" ? "Delete draft" : "Delete"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
