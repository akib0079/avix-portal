"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { MilestoneStatus } from "@prisma/client";
import {
  reorderMilestones,
  setMilestoneStatus,
  deleteMilestone,
} from "@/lib/actions/milestones";
import type { MilestoneView } from "./milestone-types";
import { MilestoneFormDialog } from "./milestone-form-dialog";
import { TimeLogDialog, formatHours } from "./time-log-dialog";
import type { ProjectBillingType } from "@prisma/client";
import { MilestoneStatusBadge } from "@/components/status-badges";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { formatPricing, milestoneStatusLabels } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  GripVertical,
  Pencil,
  Trash2,
  Plus,
  Loader2,
  ChevronDown,
  ChevronUp,
  BadgeDollarSign,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

function SortableRow({
  milestone,
  index,
  billingType,
  onEdit,
  onDelete,
  onLogTime,
}: {
  milestone: MilestoneView;
  index: number;
  billingType: ProjectBillingType;
  onEdit: () => void;
  onDelete: () => void;
  onLogTime: () => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: milestone.id });

  const hasDescription = hasRichTextContent(milestone.description);
  // Per-milestone pricing is hidden (not deleted) on fixed-contract projects.
  const pricing = billingType === "CONTRACT" ? null : formatPricing(milestone);
  const showEstimate =
    billingType === "MILESTONE" &&
    milestone.pricingType === "HOURLY" &&
    milestone.estimatedHours != null;

  async function changeStatus(status: MilestoneStatus) {
    const result = await setMilestoneStatus(milestone.id, status);
    if (!result.ok) return void toast.error(result.error);
    router.refresh();
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-xl border bg-card",
        isDragging && "z-10 opacity-80 shadow-lg ring-2 ring-primary/30",
      )}
    >
      <div className="flex items-start gap-2 p-3 sm:items-center sm:gap-3 sm:p-4">
        <button
          className="mt-1 shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing sm:mt-0"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>

        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-semibold text-primary sm:mt-0">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{milestone.title}</p>
            <MilestoneStatusBadge status={milestone.status} />
          </div>
          {pricing && (
            <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-primary">
              <BadgeDollarSign className="size-3.5" /> {pricing}
            </p>
          )}
          <button
            type="button"
            onClick={onLogTime}
            className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Clock className="size-3.5" />
            {milestone.loggedHours > 0
              ? `${formatHours(milestone.loggedHours)} logged${
                  showEstimate ? ` of ${formatHours(milestone.estimatedHours!)} est` : ""
                }`
              : "Log time"}
          </button>
          {hasDescription && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {expanded ? "Hide details" : "Show details"}
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Select
            value={milestone.status}
            onValueChange={(v) => changeStatus(v as MilestoneStatus)}
          >
            <SelectTrigger size="sm" className="hidden w-[130px] sm:flex">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(milestoneStatusLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      </div>
      {expanded && hasDescription && (
        <div className="border-t px-4 py-3 pl-14">
          <RichTextViewer content={milestone.description} />
        </div>
      )}
    </div>
  );
}

export function MilestoneBoard({
  projectId,
  milestones,
  billingType = "MILESTONE",
}: {
  projectId: string;
  milestones: MilestoneView[];
  billingType?: ProjectBillingType;
}) {
  const router = useRouter();
  const [items, setItems] = useState(milestones);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MilestoneView | null>(null);
  const [deleting, setDeleting] = useState<MilestoneView | null>(null);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep local order in sync when the server list changes (adjust-during-render).
  const [prevMilestones, setPrevMilestones] = useState(milestones);
  if (milestones !== prevMilestones) {
    setPrevMilestones(milestones);
    setItems(milestones);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((m) => m.id === active.id);
    const newIndex = items.findIndex((m) => m.id === over.id);
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next); // optimistic

    const result = await reorderMilestones(projectId, next.map((m) => m.id));
    if (!result.ok) {
      setItems(items); // revert
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">
          Milestones{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({items.length})
          </span>
        </h2>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus /> Add Milestone
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          No milestones yet — add the first step of this project.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((m) => m.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2.5">
              {items.map((milestone, index) => (
                <SortableRow
                  key={milestone.id}
                  milestone={milestone}
                  index={index}
                  billingType={billingType}
                  onEdit={() => {
                    setEditing(milestone);
                    setFormOpen(true);
                  }}
                  onDelete={() => setDeleting(milestone)}
                  onLogTime={() => setLoggingId(milestone.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <MilestoneFormDialog
        projectId={projectId}
        milestone={editing}
        open={formOpen}
        onOpenChange={setFormOpen}
        billingType={billingType}
      />

      <TimeLogDialog
        milestone={items.find((m) => m.id === loggingId) ?? null}
        open={!!loggingId}
        onOpenChange={(open) => !open && setLoggingId(null)}
      />

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.title}”?</DialogTitle>
            <DialogDescription>
              This removes the milestone from the project board. This can&apos;t
              be undone.
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
                const result = await deleteMilestone(deleting.id);
                setBusy(false);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Milestone deleted.");
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
