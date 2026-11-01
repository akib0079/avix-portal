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
  setRetainerActive,
  skipNextRun,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Lane, LaneEmpty, LaneScroller, ViewToggle, VIEW_MODES } from "@/components/ui/lanes";
import { SoftPill } from "@/components/ui/status-pill";
import { HUE } from "@/lib/status-colors";
import { useLocalChoice, useLocalSet } from "@/lib/use-local-pref";
import { formatCurrency } from "@/lib/currency";
import { cadenceSuffix, longDay, monthlyUsd, shortDay, type Day } from "@/lib/recurring";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ChevronRight,
  FileText,
  Link2,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
  Repeat,
  SkipForward,
  Trash2,
  Unlink,
} from "lucide-react";

/**
 * Where each plan stands in its current period — the question the page
 * exists to answer. A plan moves along on its own as its latest invoice
 * does: drafted, sent, paid. A plan with nothing yet (or a run that has come
 * due) is scheduled; paused and ended plans sit apart and draft nothing.
 */
type LaneId = "scheduled" | "drafted" | "sent" | "paid" | "paused" | "ended";

const LANES: { id: LaneId; title: string; color: string; hint: string }[] = [
  { id: "scheduled", title: "Scheduled", color: HUE.sky, hint: "Its next invoice is on the way" },
  { id: "drafted", title: "Drafted", color: HUE.violet, hint: "Review the draft and send it" },
  { id: "sent", title: "Sent", color: HUE.blue, hint: "Waiting on the client" },
  { id: "paid", title: "Paid", color: HUE.green, hint: "This period is settled" },
  { id: "paused", title: "Paused", color: HUE.slate, hint: "Nothing is drafted until resumed" },
  { id: "ended", title: "Ended", color: HUE.muted, hint: "Made all its invoices" },
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

/** The plan's latest invoice, unless it was voided. */
function currentInvoice(r: RetainerView): RetainerInvoice | null {
  return r.invoices.find((i) => i.status !== "CANCELLED") ?? null;
}

function laneOf(r: RetainerView): LaneId {
  if (r.state === "ended") return "ended";
  if (r.state === "paused") return "paused";
  if (r.due) return "scheduled";
  const current = currentInvoice(r);
  if (!current) return "scheduled";
  if (current.status === "PAID") return "paid";
  // DRAFT since v49; plans drafted before that left unsent ASSIGNED invoices.
  if (current.status === "DRAFT" || (current.status === "ASSIGNED" && !current.sent)) {
    return "drafted";
  }
  return "sent";
}

function mrrOf(rows: RetainerView[]) {
  return monthlyUsd(rows.filter((r) => r.state === "active"));
}

export function RetainerManager({
  retainers,
  clients,
  projects,
  today,
}: {
  retainers: RetainerView[];
  clients: RetainerClientOption[];
  projects: RetainerProjectOption[];
  /** Agency today, "YYYY-MM-DD": the calendar the schedule runs on. */
  today: Day;
}) {
  const router = useRouter();
  const [view, setView] = useLocalChoice("avix.retainers.view", "board", VIEW_MODES);
  const [folded, toggleFold] = useLocalSet("avix.retainers.folded", ["paused", "ended"]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RetainerView | null>(null);
  const [deleting, setDeleting] = useState<RetainerView | null>(null);
  const [busy, setBusy] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
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

  const laneFor = (r: RetainerView) => moved[r.id] ?? laneOf(r);
  const active = retainers.find((r) => r.id === activeId) ?? null;

  function unmove(id: string) {
    setMoved((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  }

  // None of these refresh the router: each action revalidates the page, and
  // its fresh rows arrive with the action's own response.

  async function attachNow(retainerId: string) {
    const invoiceId = attachPick[retainerId];
    if (!invoiceId) return;
    setAttachingId(retainerId);
    const result = await attachInvoiceToRetainer(retainerId, invoiceId);
    setAttachingId(null);
    if (!result.ok) return void toast.error(result.error);
    setAttachPick((m) => ({ ...m, [retainerId]: "" }));
    toast.success("Invoice linked to this plan.");
  }

  async function detachNow(invoiceId: string) {
    setDetachingId(invoiceId);
    const result = await detachInvoiceFromRetainer(invoiceId);
    setDetachingId(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Invoice unlinked.");
  }

  async function generateNow(r: RetainerView) {
    setWorkingId(r.id);
    setMoved((m) => ({ ...m, [r.id]: "drafted" }));
    const result = await generateRetainerInvoice(r.id);
    setWorkingId(null);
    if (!result.ok) {
      unmove(r.id);
      return void toast.error(result.error);
    }
    const made = result.data!;
    toast.success(
      made.count > 1
        ? `${made.count} invoices drafted, up to ${made.invoiceNumber}. Review and send them.`
        : `Invoice ${made.invoiceNumber} drafted. Review and send it.`,
      { action: { label: "Open", onClick: () => router.push(`/admin/invoices/${made.invoiceId}`) } },
    );
  }

  async function skipNext(r: RetainerView) {
    setWorkingId(r.id);
    const result = await skipNextRun(r.id);
    setWorkingId(null);
    if (!result.ok) return void toast.error(result.error);
    const { skipped, nextDay } = result.data!;
    toast.success(
      nextDay
        ? `Skipped ${shortDay(skipped)}. Next invoice ${longDay(nextDay)}.`
        : `Skipped ${shortDay(skipped)}. That was the last one, so the plan has ended.`,
    );
  }

  async function setActive(r: RetainerView, on: boolean, lane?: LaneId) {
    if (lane) setMoved((m) => ({ ...m, [r.id]: lane }));
    setWorkingId(r.id);
    const result = await setRetainerActive(r.id, on);
    setWorkingId(null);
    if (!result.ok) {
      unmove(r.id);
      return void toast.error(result.error);
    }
    const nextDay = result.data?.nextDay;
    toast.success(
      on
        ? `${r.title} resumed.${nextDay ? ` Next invoice ${longDay(nextDay)}.` : ""}`
        : `${r.title} paused. Nothing is drafted until you resume it.`,
    );
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  /**
   * A drop does what the lane means, and only where that is a safe, single
   * step: pause, resume, or draft this period's invoice. Sending and payment
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

    if (from === "ended" || to === "ended") {
      return void toast.info("Edit the plan to change when it ends.");
    }
    if (to === "paused") return void setActive(r, false, "paused");
    if (from === "paused") return void setActive(r, true, "scheduled");
    if (from === "scheduled" && to === "drafted") return void generateNow(r);

    const current = currentInvoice(r);
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

  const mrr = mrrOf(retainers);
  const activeCount = retainers.filter((r) => r.state === "active").length;

  function renderCard(r: RetainerView, opts: { ghost?: boolean; overlay?: boolean } = {}) {
    return (
      <RetainerCard
        r={r}
        lane={laneFor(r)}
        today={today}
        ghost={opts.ghost}
        overlay={opts.overlay}
        working={workingId === r.id}
        onGenerate={() => generateNow(r)}
        onSkip={() => skipNext(r)}
        onToggleActive={() => setActive(r, r.state !== "active")}
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
          <span className="font-semibold text-foreground">{usdWhole.format(mrr.total)}/month</span>{" "}
          across {activeCount} active plan{activeCount === 1 ? "" : "s"}
          {mrr.missing > 0 && (
            <span className="text-amber-700 dark:text-amber-300">
              {" "}
              · {mrr.missing} without a USD value, not counted
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Repeat /> New plan
          </Button>
        </div>
      </div>

      {retainers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-4 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Repeat className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 font-medium">No recurring plans yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Make any invoice repeat from its own page, or set up a plan here. An invoice is
            made for every period, for you to review and send.
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
        today={today}
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.title}”?</DialogTitle>
            <DialogDescription>
              Its invoices are kept, unlinked from the plan. No new ones are made. To stop
              it for a while instead, pause it.
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
                toast.success("Plan deleted.");
                setDeleting(null);
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
  const { total } = monthlyUsd(rows);
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

/** "Next invoice 1 Dec", "Due now", "Paused", "Ended after 12". */
function ScheduleLine({ r, today }: { r: RetainerView; today: Day }) {
  if (r.state === "ended") {
    return (
      <span className="text-muted-foreground">
        Ended after {r.runCount} invoice{r.runCount === 1 ? "" : "s"}
      </span>
    );
  }
  if (r.state === "paused") return <span className="text-muted-foreground">Paused</span>;
  if (r.due) {
    return (
      <span className="font-medium text-amber-700 dark:text-amber-300">
        Due now · drafts on the next run
      </span>
    );
  }
  if (!r.nextDay) return null;
  return (
    <span className="text-muted-foreground">
      Next invoice{" "}
      <span className="font-medium text-foreground">
        {r.nextDay === today ? "today" : shortDay(r.nextDay)}
      </span>
    </span>
  );
}

function endsLabel(r: RetainerView): string | null {
  if (r.state === "ended") return null;
  const left = r.remaining == null ? "" : ` · ${r.remaining} left`;
  if (r.endAfterCount != null) return `Ends after ${r.endAfterCount}${left}`;
  if (r.endDay) return `Ends ${longDay(r.endDay)}${left}`;
  return null;
}

/**
 * One plan. The same card serves the list and a lane, laying out side by
 * side when it has the room. Its invoice history — and the attach/unlink
 * controls — fold away; a lane of open histories could not be scanned.
 */
function RetainerCard({
  r,
  lane,
  today,
  ghost,
  overlay,
  working,
  onGenerate,
  onSkip,
  onToggleActive,
  onEdit,
  onDelete,
  attach,
  detachingId,
  onDetach,
}: {
  r: RetainerView;
  lane: LaneId;
  today: Day;
  ghost?: boolean;
  overlay?: boolean;
  working: boolean;
  onGenerate: () => void;
  onSkip: () => void;
  onToggleActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
  attach: { pick: string; setPick: (v: string) => void; busy: boolean; run: () => void };
  detachingId: string | null;
  onDetach: (invoiceId: string) => void;
}) {
  const current = currentInvoice(r);
  const ends = endsLabel(r);
  const live = r.state === "active";
  // Pointer and key events stop at the menu, so it never starts a drag.
  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
  };

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
        !live && !ghost && "opacity-75",
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />

      <div className="flex flex-col gap-3 @[34rem]:flex-row @[34rem]:items-start @[34rem]:justify-between">
        <div className="min-w-0">
          <p className="flex items-start gap-2 text-sm font-semibold [overflow-wrap:anywhere]">
            {live ? (
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
              <CalendarClock className="size-3" />
              {r.cadence}
            </span>
            <SoftPill color={r.autoSend ? HUE.green : HUE.slate} className="px-2 text-[10px]">
              {r.autoSend ? "Sends itself" : "Drafts for review"}
            </SoftPill>
            {current && (
              <Link
                href={`/admin/invoices/${current.id}`}
                className="inline-flex items-center gap-1.5 font-medium hover:text-primary"
              >
                {current.invoiceNumber}
                <InvoiceStatusBadge status={current.status} />
              </Link>
            )}
          </div>

          <p className="mt-1.5 text-[11px]">
            <ScheduleLine r={r} today={today} />
            {ends && <span className="text-muted-foreground"> · {ends}</span>}
          </p>
          {r.lastRunError && (
            <p className="mt-1.5 flex items-start gap-1 text-[11px] font-medium text-red-700 dark:text-red-300">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              <span className="min-w-0">{r.lastRunError}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t pt-3 @[34rem]:flex-row @[34rem]:items-center @[34rem]:border-t-0 @[34rem]:pt-0">
          <div className="flex items-center gap-1">
            <span className="num mr-auto text-lg font-bold text-primary @[34rem]:mr-1">
              {formatCurrency(r.amount, r.currency)}
              <span className="text-xs font-normal text-muted-foreground">{cadenceSuffix(r)}</span>
            </span>
            {!overlay && (
              <span {...stop} className="contents">
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger
                    aria-label={`Actions for ${r.title}`}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {working ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <MoreHorizontal className="size-4" />
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {live && (
                      <>
                        <DropdownMenuItem onSelect={onGenerate}>
                          <FileText /> Generate now
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={onSkip}>
                          <SkipForward /> Skip next
                        </DropdownMenuItem>
                      </>
                    )}
                    {r.state !== "ended" && (
                      <DropdownMenuItem onSelect={onToggleActive}>
                        {live ? <PauseCircle /> : <PlayCircle />}
                        {live ? "Pause" : "Resume"}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={onEdit}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            )}
          </div>
          {lane === "scheduled" && live && !overlay && (
            <Button
              variant={r.due ? "default" : "outline"}
              size="sm"
              className="h-8 w-full @[34rem]:w-auto"
              disabled={working}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onGenerate}
              title="Draft this period's invoice now"
            >
              {working ? <Loader2 className="animate-spin" /> : <FileText className="size-3.5" />}
              Generate now
            </Button>
          )}
        </div>
      </div>

      {!overlay && (
        <details className="group/history mt-3 border-t pt-2.5">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open/history:rotate-90" />
            Invoices ({r.invoiceCount})
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
                      {inv.invoiceNumber} · {formatCurrency(inv.amount, inv.currency)}
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
              None yet — generate this period&apos;s, or attach an existing one.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {r.invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <Link href={`/admin/invoices/${inv.id}`} className="font-medium hover:text-primary">
                    {inv.invoiceNumber}
                  </Link>
                  <span className="text-muted-foreground tabular-nums">
                    {formatCurrency(inv.amount, inv.currency)} ·{" "}
                    {new Date(inv.issueDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </span>
                  <InvoiceStatusBadge status={inv.status} />
                  {r.template?.id === inv.id && (
                    <SoftPill color={HUE.violet} className="px-2 text-[10px]">
                      Template
                    </SoftPill>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-7 text-muted-foreground hover:text-destructive"
                    title="Unlink from this plan"
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
              {r.invoiceCount > r.invoices.length && (
                <li className="text-[11px] text-muted-foreground">
                  and {r.invoiceCount - r.invoices.length} older
                </li>
              )}
            </ul>
          )}
        </details>
      )}
    </article>
  );
}
