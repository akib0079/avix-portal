"use client";

import { useState } from "react";
import useSWR from "swr";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { JSONContent } from "@tiptap/react";
import type { Priority, ProjectBillingType, ProjectTaskStatus } from "@prisma/client";
import { toast } from "sonner";
import {
  BOARD_COLUMNS,
  PRIORITY_META,
  type BoardData,
  type BoardPerson,
  type BoardPhase,
  type WorkItem,
  type WorkRole,
} from "@/lib/board";
import { createWorkItem } from "@/lib/actions/project-board";
import { approvalPricingSchema, type ApprovalPricingInput } from "@/lib/validation/task-request";
import { RichTextEditor } from "@/components/editor/rich-text-editor-lazy";
import { PricingFields } from "@/components/milestones/pricing-fields";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PersonAvatar, PriorityFlag } from "./board-bits";
import type { BoardViewer } from "./work-store";
import {
  BadgeDollarSign,
  ChevronDown,
  Flag,
  Loader2,
  Milestone as MilestoneIcon,
  UserRound,
  X,
} from "lucide-react";

const boardFetcher = (url: string) =>
  fetch(url).then((r) => (r.ok ? (r.json() as Promise<BoardData>) : null));

/**
 * The full "new item" form: a title, the details, where it starts, which
 * phase it sits under, who's on it, and — for an admin — its price. The list
 * and the board both open it. Also opened from chat ("Make a task") with the
 * message prefilled, in which case it fetches the people and phases itself,
 * from the same endpoint the board polls. A client's addition is a request:
 * it skips the stage choice and waits in Requested for the team.
 */
export function NewTaskDialog({
  open,
  onOpenChange,
  projectId,
  viewer,
  billingType,
  people: givenPeople,
  phases: givenPhases,
  defaultStage = "TODO",
  defaultParentId = null,
  defaultTitle = "",
  defaultDescription = null,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Without a role (chat), nobody is offered pricing. */
  viewer: Pick<BoardViewer, "id" | "side"> & { role?: WorkRole };
  /** Per-item pricing is off on fixed-contract projects. */
  billingType?: ProjectBillingType;
  people?: BoardPerson[];
  phases?: BoardPhase[];
  defaultStage?: ProjectTaskStatus;
  /** "Add work to this phase" from a phase row. */
  defaultParentId?: string | null;
  defaultTitle?: string;
  defaultDescription?: JSONContent | null;
  onCreated?: (item: WorkItem) => void;
}) {
  const { data } = useSWR(
    // Its own key: the board stores a timestamped wrapper under the plain URL.
    givenPeople ? null : `/api/projects/${projectId}/board?for=new-task`,
    boardFetcher,
    { revalidateOnFocus: false },
  );
  const people = givenPeople ?? data?.people ?? [];
  const milestones = givenPhases ?? data?.phases ?? [];

  const [status, setStatus] = useState<ProjectTaskStatus>(
    defaultStage === "REQUESTED" ? "TODO" : defaultStage,
  );
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState<JSONContent | null>(defaultDescription);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [milestoneId, setMilestoneId] = useState<string | null>(defaultParentId);
  const [saving, setSaving] = useState(false);
  // Pricing is the admin's (staff are money-blind; the server drops theirs),
  // and folded away until asked for: most new work is part of the plan.
  const canPrice = viewer.role === "ADMIN" && !!billingType && billingType !== "CONTRACT";
  const [pricingOpen, setPricingOpen] = useState(false);
  const pricingForm = useForm<ApprovalPricingInput>({
    resolver: zodResolver(approvalPricingSchema),
    defaultValues: { pricingType: "NONE", hourlyRate: null, estimatedHours: null, fixedPrice: null },
  });

  const assignee = assigneeId ? people.find((p) => p.id === assigneeId) : undefined;
  const milestone = milestoneId ? milestones.find((m) => m.id === milestoneId) : undefined;
  const pickable = people.filter((p) => viewer.side === "ADMIN" || p.role !== "CLIENT");

  async function submit() {
    if (!title.trim() || saving) return;
    const priced = canPrice && pricingOpen;
    if (priced && !(await pricingForm.trigger())) return;
    setSaving(true);
    const result = await createWorkItem({
      projectId,
      title: title.trim(),
      description,
      stage: status,
      priority,
      dueDate: dueDate || null,
      parentId: milestoneId,
      assigneeId,
      ...(priced ? { pricing: pricingForm.getValues() } : {}),
    });
    setSaving(false);
    if (!result.ok) return void toast.error(result.error);
    const waiting = result.data.item.stage === "REQUESTED";
    toast.success(
      viewer.side === "CLIENT"
        ? waiting
          ? "Request sent — it waits in Requested until the team picks it up."
          : assignee
            ? `Task added — ${assignee.name.split(" ")[0]} has been notified.`
            : "Task added — the team has been notified."
        : "Added.",
    );
    onCreated?.(result.data.item);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader className="border-b px-5 pt-5 pb-4">
          <DialogTitle className="font-heading text-lg">
            {viewer.side === "CLIENT" ? "Request a task" : "New milestone"}
          </DialogTitle>
          <DialogDescription>
            {viewer.side === "CLIENT"
              ? "Tell us what you need. It goes to the team as a request — pin someone and they'll get the details straight away."
              : "Add work to the plan — the client sees it in their list and on their board."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70dvh] space-y-4 overflow-y-auto px-5 py-4">
          {/* Stage, as monday-style status chips. The team's choice only:
              a client's addition always starts as a request. */}
          {viewer.side === "ADMIN" && (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Stage">
              {BOARD_COLUMNS.filter((c) => c.id !== "REQUESTED").map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={status === c.id}
                  onClick={() => setStatus(c.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                    status === c.id ? "border-transparent text-white shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                  style={status === c.id ? { background: c.color } : undefined}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault();
            }}
            placeholder={viewer.side === "CLIENT" ? "What do you need?" : "Milestone name"}
            maxLength={200}
            aria-label="Title"
            className="font-heading w-full bg-transparent text-xl font-semibold outline-none placeholder:text-muted-foreground/70"
          />

          <RichTextEditor
            value={description}
            onChange={setDescription}
            placeholder="Details — links, screenshots, what “done” looks like…"
            allowImages
          />

          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={chip}>
                  {assignee ? <PersonAvatar person={assignee} size={20} /> : <UserRound className="size-3.5" />}
                  {assignee?.name ?? "Pin someone"}
                  <ChevronDown className="size-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-60 overflow-y-auto">
                {pickable.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading people…</p>
                )}
                {pickable.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => setAssigneeId(p.id)}>
                    <PersonAvatar person={p} size={20} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground">{p.role === "CLIENT" ? "Client" : "Team"}</span>
                  </DropdownMenuItem>
                ))}
                {assigneeId && (
                  <DropdownMenuItem onSelect={() => setAssigneeId(null)} className="text-muted-foreground">
                    <X /> Nobody
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={chip}>
                  {priority ? <PriorityFlag priority={priority} withLabel /> : <><Flag className="size-3.5" /> Priority</>}
                  <ChevronDown className="size-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
                  <DropdownMenuItem key={p} onSelect={() => setPriority(p)}>
                    <Flag className="size-4" style={{ color: PRIORITY_META[p].color }} fill="currentColor" />
                    {PRIORITY_META[p].label}
                  </DropdownMenuItem>
                ))}
                {priority && (
                  <DropdownMenuItem onSelect={() => setPriority(null)} className="text-muted-foreground">
                    <X /> None
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <label className={cn(chip, "cursor-pointer")}>
              <span className="sr-only">Due date</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={cn("bg-transparent text-xs outline-none", !dueDate && "text-muted-foreground")}
              />
            </label>

            {milestones.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={cn(chip, "max-w-[14rem]")}>
                    <MilestoneIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{milestone?.title ?? "Phase"}</span>
                    <ChevronDown className="size-3 shrink-0 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
                  {milestones.map((m) => (
                    <DropdownMenuItem key={m.id} onSelect={() => setMilestoneId(m.id)}>
                      <span className="truncate">{m.title}</span>
                    </DropdownMenuItem>
                  ))}
                  {milestoneId && (
                    <DropdownMenuItem onSelect={() => setMilestoneId(null)} className="text-muted-foreground">
                      <X /> Top level
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {canPrice && !pricingOpen && (
              <button type="button" className={chip} onClick={() => setPricingOpen(true)}>
                <BadgeDollarSign className="size-3.5" /> Price it
              </button>
            )}
          </div>

          {canPrice && pricingOpen && (
            <Form {...pricingForm}>
              <PricingFields form={pricingForm} />
            </Form>
          )}
        </div>

        <div className="flex items-center gap-3 border-t bg-muted/30 px-5 py-3">
          <p className="hidden text-xs text-muted-foreground sm:block">
            <kbd className="rounded border bg-background px-1">Ctrl</kbd>+<kbd className="rounded border bg-background px-1">Enter</kbd> to create
          </p>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={!title.trim() || saving}>
              {saving && <Loader2 className="animate-spin" />}{" "}
              {viewer.side === "CLIENT" ? "Send request" : "Add milestone"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const chip =
  "inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground";
