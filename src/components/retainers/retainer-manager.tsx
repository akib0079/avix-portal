"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import type { RetainerInvoice, RetainerView } from "@/lib/dal/retainers";
import {
  deleteRetainer,
  generateRetainerInvoice,
  attachInvoiceToRetainer,
  detachInvoiceFromRetainer,
  updateRetainer,
} from "@/lib/actions/retainers";
import { InvoiceStatusBadge } from "@/components/status-badges";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RetainerFormDialog,
  type RetainerClientOption,
  type RetainerProjectOption,
} from "./retainer-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Lane, LaneEmpty, LaneScroller, ViewToggle, VIEW_MODES } from "@/components/ui/lanes";
import { HUE } from "@/lib/status-colors";
import { useLocalChoice, useLocalSet } from "@/lib/use-local-pref";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Repeat,
  PauseCircle,
  FileText,
  Link2,
  Unlink,
  CalendarDays,
  ChevronRight,
  Building2,
} from "lucide-react";

/**
 * Where each plan stands in THIS month's billing cycle — the question the
 * page exists to answer. A plan moves along on its own as its invoice does:
 * drafted, sent, paid. Paused plans sit apart and draft nothing.
 */
type LaneId = "todraft" | "drafted" | "sent" | "paid" | "paused";

const LANES: { id: LaneId; title: string; color: string; hint: string }[] = [
  { id: "todraft", title: "To draft", color: HUE.sky, hint: "No invoice for this month yet" },
  { id: "drafted", title: "Drafted", color: HUE.violet, hint: "Review the draft and send it" },
  { id: "sent", title: "Sent", color: HUE.blue, hint: "Waiting on the client" },
  { id: "paid", title: "Paid", color: HUE.green, hint: "This month is settled" },
  { id: "paused", title: "Paused", color: HUE.slate, hint: "No invoices drafted" },
];
const LANE_BY_ID = Object.fromEntries(LANES.map((l) => [l.id, l])) as Record<
  LaneId,
  (typeof LANES)[number]
>;

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** This month's invoice: the newest linked one issued in the period, unless voided. */
function currentInvoice(r: RetainerView, period: string): RetainerInvoice | null {
  return (
    r.invoices.find((i) => i.issueDate.slice(0, 7) === period && i.status !== "CANCELLED") ??
    null
  );
}

function laneOf(r: RetainerView, period: string): LaneId {
  if (!r.active) return "paused";
  const current = currentInvoice(r, period);
  if (current) {
    if (current.status === "PAID") return "paid";
    if (current.status === "ASSIGNED") return "drafted";
    return "sent";
  }
  // Stamped as drafted but its invoice is gone (deleted or unlinked): it
  // can't be drafted again this month, so it waits with the drafts.
  if (r.lastGeneratedPeriod === period) return "drafted";
  return "todraft";
}

function toInput(r: RetainerView, active: boolean) {
  return {
    title: r.title,
    clientId: r.clientId,
    projectId: r.projectId ?? "none",
    amount: r.amount,
    dayOfMonth: r.dayOfMonth,
    active,
    notes: r.notes ?? "",
  };
}

export function RetainerManager({
  retainers,
  clients,
  projects,
  period,
  today,
}: {
  retainers: RetainerView[];
  clients: RetainerClientOption[];
  projects: RetainerProjectOption[];
  /** "YYYY-MM" — the billing month, read on the server like the drafting job does. */
  period: string;
  /** Day of the month on the server, for "drafts itself in N days". */
  today: number;
}) {
  const router = useRouter();
  const [view, setView] = useLocalChoice("avix.retainers.view", "board", VIEW_MODES);
  const [folded, toggleFold] = useLocalSet("avix.retainers.folded", ["paused"]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RetainerView | null>(null);
  const [deleting, setDeleting] = useState<RetainerView | null>(null);
  const [busy, setBusy] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [attachPick, setAttachPick] = useState<Record<string, string>>({});
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [detachingId, setDetachingId] = useState<string | null>(null);
  // Optimistic lane per plan while a drop is saving. Cleared when fresh rows arrive.
  const [moved, setMoved] = useState<Record<string, LaneId>>({});
  const [prevRetainers, setPrevRetainers] = useState(retainers);
  if (retainers !== prevRetainers) {
    setPrevRetainers(retainers);
    setMoved({});
  }
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const laneFor = (r: RetainerView) => moved[r.id] ?? laneOf(r, period);
  const active = retainers.find((r) => r.id === activeId) ?? null;

  function unmove(id: string) {
    setMoved((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  }

  async function attachNow(retainerId: string) {
    const invoiceId = attachPick[retainerId];
    if (!invoiceId) return;
    setAttachingId(retainerId);
    const result = await attachInvoiceToRetainer(retainerId, invoiceId);
    setAttachingId(null);
    if (!result.ok) return void toast.error(result.error);
    setAttachPick((m) => ({ ...m, [retainerId]: "" }));
    toast.success("Invoice linked to this retainer.");
    router.refresh();
  }

  async function detachNow(invoiceId: string) {
    setDetachingId(invoiceId);
    const result = await detachInvoiceFromRetainer(invoiceId);
    setDetachingId(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Invoice unlinked.");
    router.refresh();
  }

  async function generateNow(r: RetainerView) {
    setGeneratingId(r.id);
    setMoved((m) => ({ ...m, [r.id]: "drafted" }));
    const result = await generateRetainerInvoice(r.id);
    setGeneratingId(null);
    if (!result.ok) {
      unmove(r.id);
      return void toast.error(result.error);
    }
    toast.success(`Invoice ${result.data?.invoiceNumber} drafted — review and send it.`);
    router.refresh();
  }

  async function setActive(r: RetainerView, on: boolean, lane: LaneId) {
    setMoved((m) => ({ ...m, [r.id]: lane }));
    const result = await updateRetainer(r.id, toInput(r, on));
    if (!result.ok) {
      unmove(r.id);
      return void toast.error(result.error);
    }
    toast.success(
      on ? `${r.title} resumed.` : `${r.title} paused — nothing is drafted until you resume it.`,
    );
    router.refresh();
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  /**
   * A drop does what the lane means, and only where that is a safe, single
   * step: pause, resume, or draft this month's invoice. Sending and payment
   * belong to the invoice — sending emails the client — so those drops
   * snap back and point at the invoice instead.
   */
  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const r = retainers.find((x) => x.id === event.active.id);
    const to = event.over?.id as LaneId | undefined;
    if (!r || !to || !LANE_BY_ID[to]) return;
    const from = laneFor(r);
    if (from === to) return;

    if (to === "paused") return void setActive(r, false, "paused");
    if (from === "paused") return void setActive(r, true, laneOf({ ...r, active: true }, period));
    if (from === "todraft" && to === "drafted") return void generateNow(r);

    const current = currentInvoice(r, period);
    const open = current
      ? { label: "Open invoice", onClick: () => router.push(`/admin/invoices/${current.id}`) }
      : undefined;
    if (to === "sent") {
      toast.info("Send it from the invoice — that emails the client.", { action: open });
    } else if (to === "paid") {
      toast.info("Mark it paid on the invoice, where the payment is recorded.", { action: open });
    } else {
      toast.info("That follows the invoice — it moves on its own.", { action: open });
    }
  }

  const activePlans = retainers.filter((r) => r.active);
  const monthlyTotal = activePlans.reduce((sum, r) => sum + r.amount, 0);

  function renderCard(r: RetainerView, opts: { ghost?: boolean; overlay?: boolean } = {}) {
    return (
      <RetainerCard
        r={r}
        lane={laneFor(r)}
        period={period}
        today={today}
        ghost={opts.ghost}
        overlay={opts.overlay}
        generating={generatingId === r.id}
        onGenerate={() => generateNow(r)}
        onEdit={() => {
          setEditing(r);
          setFormOpen(true);
        }}
        onDelete={() => setDeleting(r)}
        attach={{
          pick: attachPick[r.id] ?? "",
          setPick: (v) => setAttachPick((m) => ({ ...m, [r.id]: v })),
          busy: attachingId === r.id,
          run: () => attachNow(r.id),
        }}
        detachingId={detachingId}
        onDetach={detachNow}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Recurring revenue:{" "}
          <span className="font-semibold text-foreground">{usd.format(monthlyTotal)}/month</span>{" "}
          across {activePlans.length} active plan{activePlans.length === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus /> New retainer
          </Button>
        </div>
      </div>

      {retainers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Repeat className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 font-medium">No retainers yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Set up a monthly plan — an invoice is drafted automatically each month for you to
            review and send.
          </p>
        </div>
      ) : view === "board" ? (
        <DndContext
          id="retainers-board"
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <LaneScroller>
            {LANES.map((lane) => {
              const rows = retainers.filter((r) => laneFor(r) === lane.id);
              return (
                <RetainerLane
                  key={lane.id}
                  lane={lane}
                  rows={rows}
                  folded={folded.has(lane.id)}
                  onToggle={() => toggleFold(lane.id)}
                  highlightSource={!!active && laneFor(active) === lane.id}
                  renderCard={(r, ghost) => renderCard(r, { ghost })}
                />
              );
            })}
          </LaneScroller>
          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }}>
            {active ? renderCard(active, { overlay: true }) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="space-y-3">{retainers.map((r) => <div key={r.id}>{renderCard(r)}</div>)}</div>
      )}

      <RetainerFormDialog
        retainer={editing}
        clients={clients}
        projects={projects}
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.title}”?</DialogTitle>
            <DialogDescription>
              Already-drafted invoices are kept; no future ones will be created.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleting) return;
                setBusy(true);
                const result = await deleteRetainer(deleting.id);
                setBusy(false);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Retainer deleted.");
                setDeleting(null);
                router.refresh();
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RetainerLane({
  lane,
  rows,
  folded,
  onToggle,
  highlightSource,
  renderCard,
}: {
  lane: (typeof LANES)[number];
  rows: RetainerView[];
  folded: boolean;
  onToggle: () => void;
  highlightSource: boolean;
  renderCard: (r: RetainerView, ghost: boolean) => React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return (
    <Lane
      color={lane.color}
      title={lane.title}
      count={rows.length}
      meta={total > 0 ? `${usdWhole.format(total)}/mo` : undefined}
      hint={lane.hint}
      collapsed={folded}
      onToggle={onToggle}
      bodyRef={setNodeRef}
      highlight={isOver || highlightSource}
      className="lg:min-w-[210px]"
      empty={rows.length === 0 ? <LaneEmpty>Nothing here</LaneEmpty> : undefined}
    >
      {rows.map((r) => (
        <DraggableRetainer key={r.id} id={r.id} render={(ghost) => renderCard(r, ghost)} />
      ))}
    </Lane>
  );
}

function DraggableRetainer({
  id,
  render,
}: {
  id: string;
  render: (ghost: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="touch-manipulation rounded-xl outline-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {render(isDragging)}
    </div>
  );
}

/**
 * One plan. The same card serves the list and a lane, laying out side by
 * side when it has the room. Its invoice history — and the attach/unlink
 * controls — fold away; a lane of open histories could not be scanned.
 */
function RetainerCard({
  r,
  lane,
  period,
  today,
  ghost,
  overlay,
  generating,
  onGenerate,
  onEdit,
  onDelete,
  attach,
  detachingId,
  onDetach,
}: {
  r: RetainerView;
  lane: LaneId;
  period: string;
  today: number;
  ghost?: boolean;
  overlay?: boolean;
  generating: boolean;
  onGenerate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  attach: { pick: string; setPick: (v: string) => void; busy: boolean; run: () => void };
  detachingId: string | null;
  onDetach: (invoiceId: string) => void;
}) {
  const current = currentInvoice(r, period);
  const late = lane === "todraft" && today >= r.dayOfMonth;
  const daysToDraft = r.dayOfMonth - today;

  return (
    <article
      style={{ "--col": LANE_BY_ID[lane].color } as CSSProperties}
      className={cn(
        "@container relative overflow-hidden rounded-xl border bg-card p-3.5 shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150",
        !overlay &&
          "hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)]",
        overlay &&
          "rotate-[1.5deg] cursor-grabbing border-[color-mix(in_oklab,var(--col)_55%,var(--border))] shadow-[0_22px_45px_-18px_rgb(15_23_42/0.45)]",
        ghost && "border-dashed opacity-35 shadow-none",
        lane === "paused" && !ghost && "opacity-75",
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />

      <div className="flex flex-col gap-3 @[34rem]:flex-row @[34rem]:items-start @[34rem]:justify-between">
        <div className="min-w-0">
          <p className="flex items-start gap-2 text-sm font-semibold [overflow-wrap:anywhere]">
            {r.active ? (
              <Repeat className="mt-0.5 size-4 shrink-0 text-primary" />
            ) : (
              <PauseCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            {r.title}
          </p>
          <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
            <Building2 className="size-3 shrink-0" />
            <span className="truncate">
              {r.clientName}
              {r.projectName ? ` · ${r.projectName}` : ""}
            </span>
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <CalendarDays className="size-3" />
              bills on the {ordinal(r.dayOfMonth)}
            </span>
            {current && (
              <Link
                href={`/admin/invoices/${current.id}`}
                className="inline-flex items-center gap-1.5 font-medium hover:text-primary"
              >
                {current.invoiceNumber}
                <InvoiceStatusBadge status={current.status as never} />
              </Link>
            )}
          </div>

          {lane === "todraft" && (
            <p
              className={cn(
                "mt-1.5 text-[11px] font-medium",
                late ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
              )}
            >
              {late
                ? `Due since the ${ordinal(r.dayOfMonth)} — draft it now`
                : `Drafts itself on the ${ordinal(r.dayOfMonth)} · in ${daysToDraft} day${daysToDraft === 1 ? "" : "s"}`}
            </p>
          )}
          {lane === "drafted" && !current && (
            <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              Drafted this month, but that invoice was removed or unlinked.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t pt-3 @[34rem]:flex-row @[34rem]:items-center @[34rem]:border-t-0 @[34rem]:pt-0">
          <div className="flex items-center gap-1">
            <span className="num mr-auto text-lg font-bold text-primary @[34rem]:mr-1">
              {usd.format(r.amount)}
              <span className="text-xs font-normal text-muted-foreground">/mo</span>
            </span>
            <Button variant="ghost" size="icon" className="size-8" onClick={onEdit}>
              <Pencil className="size-4" />
              <span className="sr-only">Edit</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="size-4" />
              <span className="sr-only">Delete</span>
            </Button>
          </div>
          {lane === "todraft" && (
            <Button
              variant={late ? "default" : "outline"}
              size="sm"
              className="h-8 w-full @[34rem]:w-auto"
              disabled={generating}
              onClick={onGenerate}
              title="Draft this month's invoice now"
            >
              {generating ? <Loader2 className="animate-spin" /> : <FileText className="size-3.5" />}
              Draft now
            </Button>
          )}
        </div>
      </div>

      {!overlay && (
        <details className="group/history mt-3 border-t pt-2.5">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open/history:rotate-90" />
            Invoices ({r.invoices.length})
          </summary>

          {r.attachable.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Select value={attach.pick} onValueChange={attach.setPick}>
                <SelectTrigger size="sm" className="h-8 w-full max-w-[210px]">
                  <SelectValue placeholder="Add existing invoice…" />
                </SelectTrigger>
                <SelectContent>
                  {r.attachable.map((inv) => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.invoiceNumber} · {usd.format(inv.amount)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={!attach.pick || attach.busy}
                onClick={attach.run}
              >
                {attach.busy ? <Loader2 className="animate-spin" /> : <Link2 className="size-3.5" />}
                Add
              </Button>
            </div>
          )}

          {r.invoices.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              None yet — draft this month&apos;s, or attach an existing one.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {r.invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <Link href={`/admin/invoices/${inv.id}`} className="font-medium hover:text-primary">
                    {inv.invoiceNumber}
                  </Link>
                  <span className="text-muted-foreground tabular-nums">
                    {usd.format(inv.amount)} ·{" "}
                    {new Date(inv.issueDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </span>
                  <InvoiceStatusBadge status={inv.status as never} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-7 text-muted-foreground hover:text-destructive"
                    title="Unlink from this retainer"
                    disabled={detachingId === inv.id}
                    onClick={() => onDetach(inv.id)}
                  >
                    {detachingId === inv.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Unlink className="size-3.5" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </article>
  );
}
