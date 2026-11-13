"use client";

import { useState, useTransition, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { InvoiceStatus } from "@prisma/client";
import { setInvoiceStatus } from "@/lib/actions/invoices";
import { invoiceStatusLabels } from "@/lib/format";
import { formatCurrency } from "@/lib/currency";
import { usdValue } from "@/lib/invoice-usd";
import { HUE, invoiceStatusColor } from "@/lib/status-colors";
import { SoftPill } from "@/components/ui/status-pill";
import { useLocalSet } from "@/lib/use-local-pref";
import { Lane, LaneCard, LaneEmpty, LaneScroller } from "@/components/ui/lanes";
import { DueChip } from "@/components/board/board-bits";
import { ShowMore, useProgressive } from "@/components/ui/progressive";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Building2, Paperclip, HandCoins, Loader2 } from "lucide-react";
import { isRecurring, rowBalance, type InvoiceListRow } from "./invoice-row";
import { RepeatMark } from "./repeat-mark";
import { InvoiceRowMenu, type InvoiceRowAction } from "./invoice-row-menu";
import { isReceivable } from "@/lib/invoice-rules";

const LANES: { status: InvoiceStatus; hint: string }[] = [
  { status: "DRAFT", hint: "Being prepared — the client can't see it" },
  { status: "ASSIGNED", hint: "In the client's portal, not emailed yet" },
  { status: "SENT", hint: "With the client" },
  { status: "IN_REVIEW", hint: "Client says it's paid — confirm" },
  { status: "PARTIALLY_PAID", hint: "Some of it has landed" },
  { status: "PAID", hint: "Settled" },
  { status: "CANCELLED", hint: "Void" },
];

/** Lane totals in whole dollars — cents are noise at a glance, and lanes are narrow. */
const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * What a lane is worth in USD, per the multi-currency rule: each invoice at
 * its own recorded USD value, never at face value. Paid lanes count what
 * was invoiced; the rest count what is still owed. Rows without a USD value
 * are left out and counted, so the gap is visible instead of silent. Credit
 * notes are money we owe, not money owed to us, so they count in no lane.
 */
function laneUsd(status: InvoiceStatus, rows: InvoiceListRow[]) {
  let total = 0;
  let missing = 0;
  for (const row of rows) {
    if (row.creditNoteForId) continue;
    // Drafts aren't owed yet: their lane shows what they will bill.
    const value = status === "PAID" || status === "DRAFT" ? row.amount : rowBalance(row);
    if (value <= 0) continue;
    // usdValue, not amountUsd: a USD invoice is worth its own total even when
    // the column was never filled (retainer runs and older rows leave it null).
    const worth = usdValue(row);
    if (worth === null) {
      missing++;
      continue;
    }
    total += value * (worth / row.amount);
  }
  return { total, missing };
}

/**
 * Invoices by status, on the same lanes as the project board. Each lane says
 * what it is worth in USD, so the board reads as a pipeline: what's drafted,
 * what's out, what the client says they've paid, what's in.
 *
 * Dragging a card is the same action as the status menu in the list. A drop
 * on Paid or Part paid with money owing opens the payment dialog (onPay), so
 * the board books the payment rather than just the label; Cancelled asks
 * first, and turns a draft away. One stray drop should not book revenue.
 */
export function InvoiceLanes({
  invoices,
  now,
  today,
  onPay,
  onAction,
}: {
  invoices: InvoiceListRow[];
  now: number;
  today: string;
  onPay: (row: InvoiceListRow, prefill: "balance" | "none") => void;
  /** The cards' "…" menu; the list owns the dialogs it opens. */
  onAction: (action: InvoiceRowAction, row: InvoiceListRow) => void;
}) {
  const [folded, toggleFold] = useLocalSet("avix.invoices.folded", ["CANCELLED"]);
  const [moved, setMoved] = useState<Record<string, InvoiceStatus>>({});
  const [prevInvoices, setPrevInvoices] = useState(invoices);
  if (invoices !== prevInvoices) {
    setPrevInvoices(invoices);
    setMoved({});
  }
  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ row: InvoiceListRow; to: InvoiceStatus } | null>(
    null,
  );
  const [saving, startSaving] = useTransition();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const rows = invoices.map((i) => (moved[i.id] ? { ...i, status: moved[i.id]! } : i));
  const active = rows.find((i) => i.id === activeId) ?? null;

  function commit(row: InvoiceListRow, to: InvoiceStatus) {
    setMoved((m) => ({ ...m, [row.id]: to }));
    startSaving(async () => {
      const result = await setInvoiceStatus(row.id, to);
      if (!result.ok) {
        setMoved((m) => {
          const next = { ...m };
          delete next[row.id];
          return next;
        });
        toast.error(result.error);
        return;
      }
      toast.success(`${row.invoiceNumber} → ${invoiceStatusLabels[to]}`);
      setConfirming(null);
    });
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const to = event.over?.id as InvoiceStatus | undefined;
    const row = rows.find((i) => i.id === event.active.id);
    if (!row || !to || row.status === to || !LANES.some((l) => l.status === to)) return;
    if ((to === "PAID" || to === "PARTIALLY_PAID") && rowBalance(row) > 0) {
      onPay(row, to === "PAID" ? "balance" : "none");
      return;
    }
    if (to === "CANCELLED" && row.status === "DRAFT") {
      // Cancelled invoices show in the client's portal; a draft never reached it.
      toast.error(
        `${row.invoiceNumber} is a draft the client can't see, so there's nothing to cancel. Delete it instead.`,
      );
      return;
    }
    if (to === "CANCELLED") {
      setConfirming({ row, to });
      return;
    }
    commit(row, to);
  }

  return (
    <>
      <DndContext
        id="invoices-board"
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <LaneScroller>
          {LANES.map((lane) => (
            <InvoiceLane
              key={lane.status}
              status={lane.status}
              hint={lane.hint}
              rows={rows.filter((i) => i.status === lane.status)}
              folded={folded.has(lane.status)}
              onToggle={() => toggleFold(lane.status)}
              highlightSource={active?.status === lane.status}
              now={now}
              today={today}
              onAction={onAction}
            />
          ))}
        </LaneScroller>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }}>
          {active ? <InvoiceCardFace row={active} now={now} today={today} overlay /> : null}
        </DragOverlay>
      </DndContext>

      <Dialog open={!!confirming} onOpenChange={(o) => !o && !saving && setConfirming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel {confirming?.row.invoiceNumber}?</DialogTitle>
            <DialogDescription>
              The invoice stays on record, struck through, and stops counting as owed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={saving}>
              Keep as is
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() => confirming && commit(confirming.row, confirming.to)}
            >
              {saving && <Loader2 className="animate-spin" />}
              Cancel invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InvoiceLane({
  status,
  hint,
  rows,
  folded,
  onToggle,
  highlightSource,
  now,
  today,
  onAction,
}: {
  status: InvoiceStatus;
  hint: string;
  rows: InvoiceListRow[];
  folded: boolean;
  onToggle: () => void;
  highlightSource: boolean;
  now: number;
  today: string;
  onAction: (action: InvoiceRowAction, row: InvoiceListRow) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const page = useProgressive(rows, status, 20);
  // Void invoices are worth nothing; a total there would read as money owed.
  const worth = status === "CANCELLED" ? { total: 0, missing: 0 } : laneUsd(status, rows);

  return (
    <Lane
      color={invoiceStatusColor[status]}
      title={invoiceStatusLabels[status]}
      count={rows.length}
      meta={
        worth.total > 0 || worth.missing > 0 ? (
          <span
            title={
              worth.missing > 0
                ? `${worth.missing} invoice${worth.missing === 1 ? " has" : "s have"} no USD value yet and ${worth.missing === 1 ? "is" : "are"} not in this total`
                : status === "PAID"
                  ? "Invoiced value of everything in this lane, in USD"
                  : status === "DRAFT"
                    ? "What these drafts will bill, in USD. Not counted as owed until sent"
                    : "Still owed on everything in this lane, in USD"
            }
          >
            {usdWhole.format(worth.total)}
            {worth.missing > 0 && <span className="text-amber-600 dark:text-amber-400"> +{worth.missing}</span>}
          </span>
        ) : undefined
      }
      hint={hint}
      collapsed={folded}
      onToggle={onToggle}
      bodyRef={setNodeRef}
      highlight={isOver || highlightSource}
      className="lg:min-w-[190px]"
      empty={rows.length === 0 ? <LaneEmpty>Drop an invoice here</LaneEmpty> : undefined}
    >
      {page.shown.map((row) => (
        <DraggableInvoice key={row.id} row={row} now={now} today={today} onAction={onAction} />
      ))}
      <ShowMore remaining={page.remaining} step={page.step} onShowMore={page.showMore} />
    </Lane>
  );
}

function DraggableInvoice({
  row,
  now,
  today,
  onAction,
}: {
  row: InvoiceListRow;
  now: number;
  today: string;
  onAction: (action: InvoiceRowAction, row: InvoiceListRow) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="touch-manipulation rounded-xl outline-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <InvoiceCardFace row={row} now={now} today={today} ghost={isDragging} onAction={onAction} />
    </div>
  );
}

function InvoiceCardFace({
  row,
  now,
  today,
  overlay,
  ghost,
  onAction,
}: {
  row: InvoiceListRow;
  now: number;
  today: string;
  overlay?: boolean;
  ghost?: boolean;
  /** Absent on the drag overlay, which is a picture of the card. */
  onAction?: (action: InvoiceRowAction, row: InvoiceListRow) => void;
}) {
  const balance = rowBalance(row);
  const settled = !isReceivable(row);
  const overdue = !settled && !!row.dueDate && Date.parse(row.dueDate) < now && balance > 0;
  const claimed = row.paymentClaimed && row.status !== "PAID";

  return (
    <div
      className="relative"
      style={{ "--col": invoiceStatusColor[row.status] } as CSSProperties}
    >
      <LaneCard
        href={overlay ? undefined : `/admin/invoices/${row.id}`}
        overlay={overlay}
        ghost={ghost}
        className={overdue ? "border-red-300/70 dark:border-red-900/70" : undefined}
      >
        {claimed && (
          <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
            <HandCoins className="size-3" /> Client says paid
          </span>
        )}
        <div className="flex items-start justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
            <span className="truncate">{row.invoiceNumber}</span>
            {isRecurring(row) && <RepeatMark row={row} />}
            {row.hasDocument && <Paperclip className="size-3 shrink-0 text-muted-foreground" />}
          </p>
          <p
            className={
              row.status === "CANCELLED"
                ? "num shrink-0 text-sm font-semibold text-muted-foreground line-through"
                : "num shrink-0 text-sm font-semibold"
            }
          >
            {formatCurrency(row.amount, row.currency)}
          </p>
        </div>
        <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <Building2 className="size-3 shrink-0" />
          <span className="truncate">{row.clientName}</span>
        </p>
        {row.projectName && (
          <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground/80">
            {row.projectName}
          </p>
        )}
        {/* pr-8 keeps the chips clear of the menu button sitting over the corner. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 pr-8">
          <DueChip
            day={row.dueDate ? row.dueDate.slice(0, 10) : null}
            done={settled}
            today={today}
          />
          {row.status === "PARTIALLY_PAID" && balance > 0 && (
            <span className="text-[11px] font-medium text-amber-700 tabular-nums dark:text-amber-300">
              {formatCurrency(balance, row.currency)} left
            </span>
          )}
          {usdValue(row) === null && !settled && (
            <span
              className="text-[11px] font-medium text-amber-700 dark:text-amber-300"
              title="No USD value yet — not counted in totals"
            >
              no USD value
            </span>
          )}
          {row.creditNoteForId && (
            <SoftPill color={HUE.violet} className="px-2 text-[10px]">
              Credit note
            </SoftPill>
          )}
        </div>
      </LaneCard>
      {/* Beside the card's link, not inside it: a button inside an <a> is
          invalid, and its click would open the invoice. */}
      {onAction && !ghost && (
        <InvoiceRowMenu row={row} onAction={onAction} className="absolute right-1.5 bottom-1.5" />
      )}
    </div>
  );
}
