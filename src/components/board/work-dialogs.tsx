"use client";

import { useState } from "react";
import useSWR from "swr";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ProjectBillingType, ProjectTaskStatus } from "@prisma/client";
import { toast } from "sonner";
import {
  COLUMN_BY_ID,
  type BoardData,
  type BoardPerson,
  type BoardPhase,
  type WorkRole,
} from "@/lib/board";
import { approvalPricingSchema, type ApprovalPricingInput } from "@/lib/validation/task-request";
import { approveTaskRequest, rejectTaskRequest } from "@/lib/actions/task-requests";
import { PricingFields } from "@/components/milestones/pricing-fields";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Form } from "@/components/ui/form";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "./board-bits";
import { Check, ChevronDown, Loader2, Milestone as MilestoneIcon, UserRound, X } from "lucide-react";

/**
 * The decisions the Milestones tab asks for in a dialog, shared by the list,
 * the board, the drawer and the cross-project Requests inbox, so a request is
 * accepted or declined the same way wherever it's met:
 *
 *  - Send back: a client returns work in review, saying what needs changing.
 *  - Accept: a request joins the plan — where it starts, who does it, by
 *    when, under which phase, and (admins only) at what price.
 *  - Decline: closes a request with the reason the client will read.
 */

const chip =
  "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground";

/* ------------------------------------------------------------------------ */
/* Send back                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Sending work back needs a reason — the team can't fix what nobody named.
 * The note is posted on the item as a comment.
 */
export function SendBackDialog({
  open,
  title,
  to,
  onCancel,
  onSend,
}: {
  open: boolean;
  title: string;
  to: ProjectTaskStatus;
  onCancel: () => void;
  onSend: (comment: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Send back to the team</DialogTitle>
          <DialogDescription>
            “{title}” goes back to {COLUMN_BY_ID[to].clientLabel}. What needs changing?
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={5000}
          placeholder="e.g. The header image is still the old one, and the button should say “Book now”."
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !note.trim()}
            onClick={async () => {
              setBusy(true);
              const ok = await onSend(note.trim());
              setBusy(false);
              if (ok) setNote("");
            }}
          >
            {busy && <Loader2 className="animate-spin" />} Send back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ */
/* Accept a request                                                         */
/* ------------------------------------------------------------------------ */

/** Where an accepted request can start. Review and Done would skip the work. */
const START_STAGES = ["BACKLOG", "TODO", "IN_PROGRESS"] as const;
export type StartStage = (typeof START_STAGES)[number];

/** What the team chose when accepting — enough to paint the item before the next poll. */
export type AcceptChoice = ApprovalPricingInput & {
  stage: StartStage;
  assigneeId: string | null;
  dueDate: string | null;
  parentId: string | null;
};

const boardFetcher = (url: string) =>
  fetch(url).then((r) => (r.ok ? (r.json() as Promise<BoardData>) : null));

export function AcceptRequestDialog({
  open,
  onOpenChange,
  requestId,
  title,
  clientName,
  projectId,
  role,
  billingType,
  people: givenPeople,
  phases: givenPhases,
  itemId,
  defaultPricing,
  onAccepted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The TaskRequest the decision is recorded on. */
  requestId: string;
  title: string;
  clientName?: string | null;
  projectId: string;
  /** Pricing is the admin's call; staff accept work at no charge. */
  role: WorkRole;
  billingType: ProjectBillingType;
  /** Omit outside a project page: they load from the project's board. */
  people?: BoardPerson[];
  phases?: BoardPhase[];
  /** The request's own item, which can't be its own phase. */
  itemId?: string | null;
  /** A price an admin already put on the request, so accepting doesn't wipe it. */
  defaultPricing?: ApprovalPricingInput;
  onAccepted?: (choice: AcceptChoice) => void;
}) {
  const { data } = useSWR(
    // Its own key: the board stores a timestamped wrapper under the plain URL.
    open && !givenPeople ? `/api/projects/${projectId}/board?for=accept` : null,
    boardFetcher,
    { revalidateOnFocus: false },
  );
  const people = givenPeople ?? data?.people ?? [];
  const phases = (givenPhases ?? data?.phases ?? []).filter((p) => p.id !== itemId);
  const loading = !givenPeople && !data;

  const [stage, setStage] = useState<StartStage>("TODO");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const priced = role === "ADMIN" && billingType !== "CONTRACT";

  const form = useForm<ApprovalPricingInput>({
    resolver: zodResolver(approvalPricingSchema),
    defaultValues: defaultPricing ?? {
      pricingType: "NONE",
      hourlyRate: null,
      estimatedHours: null,
      fixedPrice: null,
    },
  });

  const assignee = assigneeId ? people.find((p) => p.id === assigneeId) : undefined;
  const phase = parentId ? phases.find((p) => p.id === parentId) : undefined;

  async function onSubmit(values: ApprovalPricingInput) {
    const choice: AcceptChoice = {
      ...(priced ? values : { pricingType: "NONE" }),
      stage,
      assigneeId,
      dueDate: dueDate || null,
      parentId,
    };
    const result = await approveTaskRequest(requestId, choice);
    if (!result.ok) return void toast.error(result.error);
    toast.success(`Accepted — it's in ${COLUMN_BY_ID[stage].label}${clientName ? `, and ${clientName} has been told` : ""}.`);
    onAccepted?.(choice);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Accept request</DialogTitle>
          <DialogDescription>
            “{title}” joins the plan{clientName ? ` and ${clientName} is notified` : ""}. Pick where it
            starts — the rest can wait.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Starts in</Label>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Starts in">
                {START_STAGES.map((s) => {
                  const column = COLUMN_BY_ID[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={stage === s}
                      onClick={() => setStage(s)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                        stage === s
                          ? "border-transparent text-white shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      style={stage === s ? { background: column.color } : undefined}
                    >
                      {column.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={chip}>
                    {assignee ? <PersonAvatar person={assignee} size={20} /> : <UserRound className="size-3.5" />}
                    <span className="truncate">{assignee?.name ?? "Assign someone"}</span>
                    <ChevronDown className="size-3 shrink-0 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 w-60 overflow-y-auto">
                  {loading && <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading people…</p>}
                  {people.map((p) => (
                    <DropdownMenuItem key={p.id} onSelect={() => setAssigneeId(p.id)}>
                      <PersonAvatar person={p} size={20} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="text-[10px] text-muted-foreground">{p.role === "CLIENT" ? "Client" : "Team"}</span>
                    </DropdownMenuItem>
                  ))}
                  {assigneeId && (
                    <DropdownMenuItem onSelect={() => setAssigneeId(null)} className="text-muted-foreground">
                      <X /> Nobody yet
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

              {phases.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={cn(chip, "max-w-[15rem]")}>
                      <MilestoneIcon className="size-3.5 shrink-0" />
                      <span className="truncate">{phase?.title ?? "Phase"}</span>
                      <ChevronDown className="size-3 shrink-0 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
                    {phases.map((p) => (
                      <DropdownMenuItem key={p.id} onSelect={() => setParentId(p.id)}>
                        <span className="truncate">{p.title}</span>
                      </DropdownMenuItem>
                    ))}
                    {parentId && (
                      <DropdownMenuItem onSelect={() => setParentId(null)} className="text-muted-foreground">
                        <X /> Top level
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {priced ? (
              <PricingFields form={form} />
            ) : role !== "ADMIN" ? (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                Accepted as part of the agreed work, at no extra charge. If it should be priced, leave
                it for an admin.
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Check />}
                Accept
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ */
/* Decline a request                                                        */
/* ------------------------------------------------------------------------ */

export function DeclineRequestDialog({
  open,
  onOpenChange,
  requestId,
  title,
  clientName,
  onDeclined,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  title: string;
  clientName?: string | null;
  onDeclined?: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = reason.trim().length >= 3;

  async function decline() {
    setBusy(true);
    const result = await rejectTaskRequest(requestId, reason);
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success(`Declined — ${clientName ?? "the client"} has your note.`);
    onDeclined?.(reason.trim());
    setReason("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Decline request</DialogTitle>
          <DialogDescription>
            Tell {clientName ?? "the client"} why “{title}” isn&apos;t going ahead. The note is emailed to
            them and stays in their request history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`decline-${requestId}`}>Reason</Label>
          <Textarea
            id={`decline-${requestId}`}
            autoFocus
            rows={4}
            maxLength={1000}
            placeholder="e.g. This is outside the current scope — happy to quote it as a separate project."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={decline} disabled={busy || !ready}>
            {busy && <Loader2 className="animate-spin" />}
            Decline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
