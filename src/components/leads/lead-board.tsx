"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { ShowMore, useProgressive } from "@/components/ui/progressive";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { LeadStage } from "@prisma/client";
import type { LeadView, LeadOwnerOption } from "@/lib/dal/leads";
import { leadStageLabels, leadSourceLabels } from "@/lib/validation/lead";
import { setLeadStage, deleteLead, convertLead } from "@/lib/actions/leads";
import { LeadFormDialog } from "./lead-form-dialog";
import { LeadImportDialog } from "./lead-import-dialog";
import { ProposalFormDialog } from "@/components/proposals/proposal-form-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usd, formatDate, initials } from "@/lib/format";
import { leadStageColor } from "@/lib/status-colors";
import { useLocalSet } from "@/lib/use-local-pref";
import { Lane, LaneEmpty, LaneScroller } from "@/components/ui/lanes";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useActivity } from "@/components/layout/activity-indicator";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  CalendarClock,
  UserRoundPlus,
  FileSignature,
  BadgeDollarSign,
  CheckCircle2,
  FileUp,
  GripVertical,
  Mail,
  Tag,
} from "lucide-react";

const STAGES: LeadStage[] = ["NEW", "CONTACTED", "PROPOSAL", "WON", "LOST"];

function isOverdue(date: string | null): boolean {
  if (!date) return false;
  return new Date(`${date}T23:59:59`) < new Date();
}

function LeadCard({
  lead,
  dragging,
  onEdit,
  onDelete,
  onConvert,
  onProposal,
}: {
  lead: LeadView;
  dragging?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onConvert?: () => void;
  onProposal?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });
  const overdue = isOverdue(lead.nextFollowUp) && lead.stage !== "WON" && lead.stage !== "LOST";

  return (
    <div
      ref={setNodeRef}
      style={{ "--col": leadStageColor[lead.stage] } as CSSProperties}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card p-3 shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150",
        !dragging &&
          "hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)]",
        isDragging && "border-dashed opacity-35 shadow-none",
        dragging &&
          "rotate-[1.5deg] border-[color-mix(in_oklab,var(--col)_55%,var(--border))] shadow-[0_22px_45px_-18px_rgb(15_23_42/0.45)]",
      )}
    >
      {/* Stage colour as a hairline on the leading edge, as on the project board. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />
      <div className="flex items-start gap-2">
        <button
          className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
          aria-label="Drag lead"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--col)] text-xs font-semibold text-white">
          {initials(lead.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{lead.name}</p>
          {lead.company && (
            <p className="truncate text-xs text-muted-foreground">{lead.company}</p>
          )}
        </div>
      </div>

      <div className="mt-2.5 space-y-1 pl-6">
        {lead.email && (
          <a
            href={`mailto:${lead.email}`}
            className="flex items-center gap-1.5 truncate text-xs text-muted-foreground hover:text-primary"
            onClick={(e) => e.stopPropagation()}
          >
            <Mail className="size-3 shrink-0" />
            <span className="truncate">{lead.email}</span>
          </a>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Tag className="size-3 shrink-0" />
          {leadSourceLabels[lead.source]}
        </div>
        {lead.nextFollowUp && lead.stage !== "WON" && lead.stage !== "LOST" && (
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              overdue ? "font-semibold text-red-600" : "text-muted-foreground",
            )}
          >
            <CalendarClock className="size-3 shrink-0" />
            {formatDate(lead.nextFollowUp)}
            {overdue && " · overdue"}
          </div>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between pl-6">
        {lead.estimatedValue != null ? (
          <span className="flex items-center gap-1 rounded-md bg-brand-tint px-2 py-0.5 text-xs font-semibold text-primary">
            <BadgeDollarSign className="size-3" />
            {usd.format(lead.estimatedValue)}
          </span>
        ) : (
          <span />
        )}
        {lead.convertedClientId && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
            <CheckCircle2 className="size-3" /> Client
          </span>
        )}
      </div>

      {/* Compact meta — the full record lives on the detail page */}
      {!dragging && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {lead.priority === "HIGH" && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
              High
            </span>
          )}
          {lead.ownerName && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {lead.ownerName}
            </span>
          )}
          {lead.tags.slice(0, 2).map((t) => (
            <span
              key={t}
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
          <Link
            href={`/admin/leads/${lead.id}`}
            className="ml-auto text-[10px] font-medium text-primary hover:underline"
          >
            Open →
          </Link>
        </div>
      )}

      {!dragging && (
        <div className="mt-2.5 flex items-center justify-end gap-0.5 border-t pt-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          {!lead.convertedClientId && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-primary hover:text-primary"
              title="Create proposal"
              onClick={onProposal}
            >
              <FileSignature className="size-3.5" />
            </Button>
          )}
          {!lead.convertedClientId && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-emerald-600 hover:text-emerald-700"
              title="Convert to client"
              onClick={onConvert}
            >
              <UserRoundPlus className="size-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-7" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function StageColumn({
  stage,
  leads,
  activeStage,
  folded,
  onToggle,
  renderCard,
}: {
  stage: LeadStage;
  leads: LeadView[];
  activeStage: LeadStage | null;
  folded: boolean;
  onToggle: () => void;
  renderCard: (lead: LeadView) => React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  // Each card is a draggable with ~60 nodes; the whole board was 17k nodes.
  // Columns render 20 at a time — WON and LOST are mostly history anyway.
  const page = useProgressive(leads, stage, 20);
  const total = leads.reduce((sum, l) => sum + (l.estimatedValue ?? 0), 0);
  const isTarget = !!activeStage && activeStage !== stage;

  return (
    <Lane
      color={leadStageColor[stage]}
      title={leadStageLabels[stage]}
      count={leads.length}
      meta={total > 0 ? usd.format(total) : undefined}
      collapsed={folded}
      onToggle={onToggle}
      bodyRef={setNodeRef}
      highlight={isOver || activeStage === stage}
      className="lg:min-w-[230px]"
      empty={
        leads.length === 0 ? <LaneEmpty>{isTarget ? "Drop here" : "Empty"}</LaneEmpty> : undefined
      }
    >
      {page.shown.map(renderCard)}
      <ShowMore remaining={page.remaining} step={page.step} onShowMore={page.showMore} />
    </Lane>
  );
}

export function LeadBoard({
  leads,
  owners = [],
}: {
  leads: LeadView[];
  owners?: LeadOwnerOption[];
}) {
  const router = useRouter();
  const { track } = useActivity();
  const [items, setItems] = useState(leads);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<LeadView | null>(null);
  const [deleting, setDeleting] = useState<LeadView | null>(null);
  const [converting, setConverting] = useState<LeadView | null>(null);
  const [losing, setLosing] = useState<LeadView | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [proposingLeadId, setProposingLeadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [folded, toggleFold] = useLocalSet("avix.leads.folded", ["LOST"]);

  const [prevLeads, setPrevLeads] = useState(leads);
  if (leads !== prevLeads) {
    setPrevLeads(leads);
    setItems(leads);
  }

  // Mouse and touch need different activation, and one PointerSensor cannot
  // serve both. dnd-kit's pointer listeners set `touch-action: none` on every
  // draggable, so on a phone — where cards cover most of the board — a finger
  // landing on a card could not scroll the page: a 5px move became a drag.
  // Distance activation for the mouse, a 200ms long-press for touch, so a
  // swipe scrolls and a deliberate hold picks the card up.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const activeLead = items.find((l) => l.id === activeId) ?? null;

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const lead = items.find((l) => l.id === active.id);
    const target = over.id as LeadStage;
    if (!lead || lead.stage === target || !STAGES.includes(target)) return;

    // Losing a lead needs a reason — ask before moving the card.
    if (target === "LOST") {
      setLosing(lead);
      return;
    }

    const previous = items;
    setItems(items.map((l) => (l.id === lead.id ? { ...l, stage: target } : l)));
    const result = await setLeadStage(lead.id, target);
    if (!result.ok) {
      setItems(previous);
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function confirmLost() {
    if (!losing) return;
    setBusy(true);
    const result = await setLeadStage(losing.id, "LOST", lostReason);
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    setItems(items.map((l) => (l.id === losing.id ? { ...l, stage: "LOST" as const } : l)));
    setLosing(null);
    setLostReason("");
    toast.success("Marked as lost.");
    router.refresh();
  }

  async function onConvert(lead: LeadView) {
    setBusy(true);
    const result = await track(convertLead(lead.id), "Creating client…");
    setBusy(false);
    setConverting(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Client created — invite sent. Set up their first project.");
    router.push(`/admin/projects/new?clientId=${result.data!.clientId}`);
    router.refresh();
  }

  const totalPipeline = items
    .filter((l) => l.stage !== "LOST")
    .reduce((sum, l) => sum + (l.estimatedValue ?? 0), 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Pipeline value:{" "}
          <span className="font-semibold text-foreground">{usd.format(totalPipeline)}</span>{" "}
          across {items.filter((l) => l.stage !== "LOST" && l.stage !== "WON").length} open
          lead{items.filter((l) => l.stage !== "LOST" && l.stage !== "WON").length === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileUp /> Import
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus /> Add lead
          </Button>
        </div>
      </div>

      <DndContext
        id="lead-board"
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <LaneScroller>
          {STAGES.map((stage) => (
            <StageColumn
              key={stage}
              stage={stage}
              leads={items.filter((l) => l.stage === stage)}
              activeStage={activeLead?.stage ?? null}
              folded={folded.has(stage)}
              onToggle={() => toggleFold(stage)}
              renderCard={(lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  onEdit={() => {
                    setEditing(lead);
                    setFormOpen(true);
                  }}
                  onDelete={() => setDeleting(lead)}
                  onConvert={() => setConverting(lead)}
                  onProposal={() => setProposingLeadId(lead.id)}
                />
              )}
            />
          ))}
        </LaneScroller>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }}>
          {activeLead ? <LeadCard lead={activeLead} dragging /> : null}
        </DragOverlay>
      </DndContext>

      <LeadFormDialog lead={editing} owners={owners} open={formOpen} onOpenChange={setFormOpen} />

      {/* Why was it lost? — required before a card can land in LOST */}
      <Dialog open={!!losing} onOpenChange={(open) => !open && setLosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Why was “{losing?.name}” lost?</DialogTitle>
            <DialogDescription>
              A short reason makes the pipeline worth learning from later.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            rows={3}
            placeholder="Budget too low, went with an in-house team…"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLosing(null)}>
              Cancel
            </Button>
            <Button onClick={confirmLost} disabled={busy || !lostReason.trim()}>
              {busy && <Loader2 className="animate-spin" />} Mark lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} />

      <ProposalFormDialog
        leads={items.map((l) => ({
          id: l.id,
          name: l.name,
          company: l.company,
          estimatedValue: l.estimatedValue,
          brandInfo: l.brandInfo,
        }))}
        presetLeadId={proposingLeadId}
        open={!!proposingLeadId}
        onOpenChange={(open) => !open && setProposingLeadId(null)}
      />

      <Dialog open={!!converting} onOpenChange={(open) => !open && setConverting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert “{converting?.name}” to a client?</DialogTitle>
            <DialogDescription>
              Creates their portal account ({converting?.email ?? "no email set"}),
              emails them an invite, and takes you to create their first project.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConverting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy || !converting?.email}
              onClick={() => converting && onConvert(converting)}
            >
              {busy ? <Loader2 className="animate-spin" /> : <UserRoundPlus />}
              Convert to client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>This removes the lead permanently.</DialogDescription>
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
                const previous = items;
                setItems(items.filter((l) => l.id !== deleting.id));
                setDeleting(null);
                setBusy(true);
                const result = await deleteLead(deleting.id);
                setBusy(false);
                if (!result.ok) {
                  setItems(previous);
                  toast.error(result.error);
                  return;
                }
                toast.success("Lead deleted.");
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
