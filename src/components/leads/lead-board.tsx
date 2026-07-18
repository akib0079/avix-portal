"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { LeadStage } from "@prisma/client";
import type { LeadView } from "@/lib/dal/leads";
import { leadStageLabels, leadSourceLabels } from "@/lib/validation/lead";
import { setLeadStage, deleteLead, convertLead } from "@/lib/actions/leads";
import { LeadFormDialog } from "./lead-form-dialog";
import { LeadImportDialog } from "./lead-import-dialog";
import { ProposalFormDialog } from "@/components/proposals/proposal-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usd, formatDate, initials } from "@/lib/format";
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
  Building2,
  Reply,
  Copy,
  Mail,
  Tag,
} from "lucide-react";

const STAGES: LeadStage[] = ["NEW", "CONTACTED", "PROPOSAL", "WON", "LOST"];

const stageStyle: Record<LeadStage, { bar: string; dot: string; ring: string }> = {
  NEW: { bar: "bg-sky-400", dot: "bg-sky-400", ring: "ring-sky-300" },
  CONTACTED: { bar: "bg-amber-400", dot: "bg-amber-400", ring: "ring-amber-300" },
  PROPOSAL: { bar: "bg-violet-400", dot: "bg-violet-400", ring: "ring-violet-300" },
  WON: { bar: "bg-emerald-400", dot: "bg-emerald-400", ring: "ring-emerald-300" },
  LOST: { bar: "bg-slate-300", dot: "bg-slate-300", ring: "ring-slate-300" },
};

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
      className={cn(
        "group rounded-xl border bg-card p-3 shadow-sm transition-shadow",
        isDragging && "opacity-40",
        dragging && "rotate-2 shadow-xl ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
          aria-label="Drag lead"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
            stageStyle[lead.stage].dot,
          )}
        >
          {initials(lead.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{lead.name}</p>
          {lead.company && (
            <p className="truncate text-xs text-muted-foreground">{lead.company}</p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-white",
            stageStyle[lead.stage].dot,
          )}
        >
          {leadStageLabels[lead.stage]}
        </span>
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

      {lead.notes && (
        <p className="mt-2 line-clamp-2 rounded-md bg-muted/50 px-2.5 py-1.5 pl-2.5 text-xs text-muted-foreground">
          {lead.notes}
        </p>
      )}

      {/* Brand info & response message */}
      {(lead.brandInfo || lead.responseMessage) && !dragging && (
        <div className="mt-2 space-y-2 rounded-md border bg-card px-2.5 py-2">
          {lead.brandInfo && (
            <div>
              <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                <Building2 className="size-3" /> Brand info
              </p>
              <p className="mt-0.5 line-clamp-3 text-xs whitespace-pre-wrap">
                {lead.brandInfo}
              </p>
            </div>
          )}
          {lead.responseMessage && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                  <Reply className="size-3" /> Response
                </p>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-primary hover:bg-brand-tint"
                  onClick={() => {
                    navigator.clipboard.writeText(lead.responseMessage ?? "");
                    toast.success("Response copied.");
                  }}
                >
                  <Copy className="size-3" /> Copy
                </button>
              </div>
              <p className="mt-0.5 line-clamp-3 text-xs whitespace-pre-wrap text-muted-foreground">
                {lead.responseMessage}
              </p>
            </div>
          )}
        </div>
      )}

      {!dragging && (
        <div className="mt-2.5 flex items-center justify-end gap-0.5 border-t pt-2 opacity-0 transition-opacity group-hover:opacity-100">
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
  children,
}: {
  stage: LeadStage;
  leads: LeadView[];
  activeStage: LeadStage | null;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = leads.reduce((sum, l) => sum + (l.estimatedValue ?? 0), 0);
  const isTarget = activeStage && activeStage !== stage;

  return (
    <div className="flex w-[300px] shrink-0 flex-col">
      <div className="mb-2 rounded-lg border bg-card px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <span className={cn("size-2 rounded-full", stageStyle[stage].dot)} />
            {leadStageLabels[stage]}
          </span>
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
            {leads.length}
          </span>
        </div>
        {total > 0 && (
          <p className="mt-0.5 pl-3.5 text-xs text-muted-foreground">{usd.format(total)}</p>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-24 flex-1 space-y-2.5 rounded-xl p-1.5 transition-colors",
          isOver && "bg-primary/5 ring-2",
          isOver && stageStyle[stage].ring,
          isTarget && !isOver && "bg-muted/40",
        )}
      >
        {leads.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
            {isTarget ? "Drop here" : "Empty"}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function LeadBoard({ leads }: { leads: LeadView[] }) {
  const router = useRouter();
  const { track } = useActivity();
  const [items, setItems] = useState(leads);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<LeadView | null>(null);
  const [deleting, setDeleting] = useState<LeadView | null>(null);
  const [converting, setConverting] = useState<LeadView | null>(null);
  const [proposingLeadId, setProposingLeadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [prevLeads, setPrevLeads] = useState(leads);
  if (leads !== prevLeads) {
    setPrevLeads(leads);
    setItems(leads);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
          {STAGES.map((stage) => (
            <StageColumn
              key={stage}
              stage={stage}
              leads={items.filter((l) => l.stage === stage)}
              activeStage={activeLead?.stage ?? null}
            >
              {items
                .filter((l) => l.stage === stage)
                .map((lead) => (
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
                ))}
            </StageColumn>
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeLead ? <LeadCard lead={activeLead} dragging /> : null}
        </DragOverlay>
      </DndContext>

      <LeadFormDialog lead={editing} open={formOpen} onOpenChange={setFormOpen} />
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
