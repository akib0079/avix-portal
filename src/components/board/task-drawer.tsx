"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { formatDistanceToNow, format } from "date-fns";
import type { JSONContent } from "@tiptap/react";
import type { Priority, ProjectTaskStatus } from "@prisma/client";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  BOARD_COLUMNS,
  COLUMN_BY_ID,
  PRIORITY_META,
  type BoardComment,
  type BoardPerson,
  type BoardPhase,
  type WorkItem,
  type WorkRole,
} from "@/lib/board";
import {
  addWorkComment,
  deleteWorkComment,
  resolveWorkHelp,
} from "@/lib/actions/project-board";
import { approvalPricingSchema, type ApprovalPricingInput } from "@/lib/validation/task-request";
import { formatPricing } from "@/lib/format";
import { formatHours, hoursProgress, requestOutcome, stageChoices } from "@/lib/work-list";
import { RichTextEditor } from "@/components/editor/rich-text-editor-lazy";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { ImageLightbox } from "@/components/editor/image-lightbox";
import { PricingFields } from "@/components/milestones/pricing-fields";
import { RateMilestone } from "@/components/portal/rate-milestone";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CommentComposer, type CommentDraft } from "./comment-composer";
import { CommentText, HoursBar, PersonAvatar, PriorityFlag, dueState, formatDay } from "./board-bits";
import { useWork, type BoardViewer } from "./work-store";
import { useWorkItemDetail } from "./use-work-item-detail";
import {
  X,
  ChevronDown,
  CircleDot,
  UserRound,
  Flag,
  CalendarDays,
  Milestone as MilestoneIcon,
  Clock,
  Lock,
  MoreHorizontal,
  Trash2,
  LifeBuoy,
  CheckCircle2,
  Pencil,
  Loader2,
  MessageSquare,
  AlignLeft,
  Link2,
  Archive,
  ArchiveRestore,
  BadgeDollarSign,
  Inbox,
  Check,
  Undo2,
  ReceiptText,
  Plus,
} from "lucide-react";

const TEMP = "temp-comment-";

/**
 * One item, opened — the same panel from the list and the board. Right-side
 * panel in the monday mould, the view still in sight beside it, split
 * ClickUp-style into the item on the left and its conversation on the right.
 * On a phone the two halves become tabs.
 *
 * What it offers follows who's looking, by the same rules the server checks:
 * the team edits everything (prices are the admin's), accepts or declines a
 * request, logs time and archives; a client approves or sends back work in
 * review, rates finished work, and edits or withdraws their own request while
 * it waits.
 */
export function TaskDrawer({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const work = useWork();
  const { viewer, people, phases, today, track } = work;
  const live = work.items.find((c) => c.id === itemId) ?? null;
  // The store reloads this whenever the board's version moves (a comment, an
  // edit, logged hours). The slow interval only catches what the version
  // can't see: a time entry's note or date, an item archived or on another
  // project.
  const { data, mutate, isLoading } = useWorkItemDetail(itemId, { refreshInterval: 60_000 });
  // The live copy paints at once; an archived item (opened from the archive
  // or an old link) isn't on the board, so it comes with the detail.
  const card = live ?? data?.item ?? null;
  // On a phone the halves are tabs; an item waiting on this viewer's answer
  // opens on the conversation, where the question is.
  const [pane, setPane] = useState<"details" | "activity">(() =>
    live?.helpFrom && live.helpFrom !== viewer.side ? "activity" : "details",
  );
  const [confirm, setConfirm] = useState<"delete" | "withdraw" | null>(null);
  const [busy, setBusy] = useState(false);

  // A link to an item that's gone (deleted, or never this viewer's) closes
  // itself instead of showing an empty panel forever.
  useEffect(() => {
    if (!isLoading && data === null && !live) {
      toast.error("That item isn't on this project any more.");
      onClose();
    }
  }, [isLoading, data, live, onClose]);

  const team = viewer.side === "ADMIN";
  const archived = !!card?.archivedAt;
  const requested = !!card && card.stage === "REQUESTED" && !archived;
  // A client's own request stays theirs to reword until the team decides it.
  const ownRequest = requested && viewer.side === "CLIENT" && card.createdById === viewer.id;
  const canEdit = !!card && !archived && (team || ownRequest);
  // Who does it and under which phase are the team's calls.
  const canEditMeta = !!card && !archived && team;
  const canPrice = viewer.role === "ADMIN" && work.billingType !== "CONTRACT";
  const comments = data?.comments ?? [];
  const openHelp = comments.filter((c) => c.kind === "HELP" && !c.resolvedAt);
  const request = data?.request ?? null;
  const outcome = request ? requestOutcome(request, card) : null;

  /** A changed item goes back where it came from: the live set, or the archive's copy. */
  function changed(item: WorkItem) {
    if (live && !item.archivedAt) work.upsert(item);
    else void mutate((cur) => (cur ? { ...cur, item } : cur), { revalidate: false });
  }

  function patch(change: Parameters<typeof work.patch>[1], optimistic: Partial<WorkItem>) {
    if (!card) return Promise.resolve(false);
    return work.patch(card.id, change, optimistic);
  }

  async function submitComment(draft: CommentDraft): Promise<boolean> {
    if (!card) return false;
    const tempId = `${TEMP}${Date.now()}`;
    const optimistic: BoardComment = {
      id: tempId,
      authorId: viewer.id,
      authorName: viewer.name,
      authorRole: viewer.side,
      authorIsStaff: false,
      kind: draft.kind,
      body: draft.body,
      mentions: people
        .filter((p) => draft.mentionIds.includes(p.id))
        .map((p) => ({ id: p.id, name: p.name })),
      attachments: draft.attachments,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    };
    await mutate(
      (cur) => (cur ? { ...cur, comments: [...cur.comments, optimistic] } : cur),
      { revalidate: false },
    );
    const result = await track(() => addWorkComment({ itemId: card.id, ...draft }));
    if (!result.ok) {
      await mutate(
        (cur) => (cur ? { ...cur, comments: cur.comments.filter((c) => c.id !== tempId) } : cur),
        { revalidate: false },
      );
      toast.error(result.error);
      return false;
    }
    await mutate(
      (cur) =>
        cur
          ? {
              ...cur,
              item: result.data.item,
              comments: cur.comments.map((c) => (c.id === tempId ? result.data.comment : c)),
            }
          : cur,
      { revalidate: false },
    );
    changed(result.data.item);
    if (draft.kind === "HELP") {
      toast.success(viewer.side === "CLIENT" ? "Help requested — the team has been notified." : "Sent to the client.");
    }
    return true;
  }

  async function resolve(commentId: string) {
    const result = await track(() => resolveWorkHelp(commentId));
    if (!result.ok) return void toast.error(result.error);
    await mutate(
      (cur) =>
        cur
          ? {
              ...cur,
              item: result.data.item,
              comments: cur.comments.map((c) => (c.id === commentId ? result.data.comment : c)),
            }
          : cur,
      { revalidate: false },
    );
    changed(result.data.item);
  }

  async function removeComment(commentId: string) {
    const previous = data;
    await mutate(
      (cur) => (cur ? { ...cur, comments: cur.comments.filter((c) => c.id !== commentId) } : cur),
      { revalidate: false },
    );
    const result = await track(() => deleteWorkComment(commentId));
    if (!result.ok) {
      await mutate(previous, { revalidate: false });
      return void toast.error(result.error);
    }
    changed(result.data.item);
  }

  async function confirmed() {
    if (!card || !confirm) return;
    setBusy(true);
    const ok = confirm === "withdraw" ? await work.withdraw(card.id) : await work.remove(card.id);
    setBusy(false);
    if (ok) setConfirm(null);
  }

  async function restore() {
    if (!card) return;
    setBusy(true);
    const item = await work.restore(card.id);
    setBusy(false);
    if (item) void mutate((cur) => (cur ? { ...cur, item } : cur), { revalidate: false });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied.");
    } catch {
      toast.error("This browser wouldn't let me copy that.");
    }
  }

  const column = card ? COLUMN_BY_ID[card.stage] : null;
  const author = card?.createdById ? people.find((p) => p.id === card.createdById) : undefined;
  const authorName =
    author?.name ?? card?.creatorName ?? (card?.createdByRole === "CLIENT" ? "Client" : "Avix Digital");
  // A waiting request is accepted or declined, not archived or deleted.
  const canArchive = !!card && team && !archived && !requested;
  const canRestore = !!card && team && archived && card.stage !== "REQUESTED";
  const canDelete = !!card && viewer.role === "ADMIN" && !archived && !requested;
  const hasMenu = canArchive || canRestore || canDelete || ownRequest;
  const priced = !!card && card.pricingType !== "NONE";
  const showPrice = !!card && (canPrice || (work.pricesShown && priced));

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/20 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col bg-background shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right-8 data-[state=open]:fade-in-0 sm:w-[min(980px,calc(100vw-2rem))] sm:rounded-l-3xl sm:border-l"
          style={column ? ({ "--col": column.color } as CSSProperties) : undefined}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b px-4 py-3 sm:px-6">
            {card && (
              <StatusPicker
                item={card}
                viewer={viewer}
                onChange={(stage) => stage !== card.stage && void work.move(card.id, stage)}
              />
            )}
            {archived && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                <Archive className="size-3" /> Archived
              </span>
            )}
            {card?.helpFrom && (
              <span className="hidden items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-600 sm:inline-flex dark:text-red-400">
                <LifeBuoy className="size-3" />
                {card.helpFrom === viewer.side ? "Waiting for an answer" : "Needs your answer"}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <IconButton label="Copy link" onClick={copyLink}>
                <Link2 className="size-4" />
              </IconButton>
              {hasMenu && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="More actions"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {canArchive && (
                      <DropdownMenuItem onSelect={() => card && void work.archive(card.id)}>
                        <Archive /> Archive
                      </DropdownMenuItem>
                    )}
                    {canRestore && (
                      <DropdownMenuItem onSelect={() => void restore()}>
                        <ArchiveRestore /> Restore
                      </DropdownMenuItem>
                    )}
                    {canDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </>
                    )}
                    {ownRequest && (
                      <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("withdraw")}>
                        <Undo2 /> Withdraw request
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DialogPrimitive.Close asChild>
                <IconButton label="Close">
                  <X className="size-4" />
                </IconButton>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Phone: details and conversation as tabs. */}
          <div className="flex gap-1 border-b px-4 py-2 lg:hidden">
            {(["details", "activity"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPane(p)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  pane === p ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                {p === "details" ? "Details" : `Comments${comments.length ? ` · ${comments.length}` : ""}`}
              </button>
            ))}
          </div>

          {!card ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
              {/* Left: the item */}
              <div className={cn("min-h-0 overflow-y-auto px-4 py-5 sm:px-8 sm:py-6", pane !== "details" && "max-lg:hidden")}>
                <DialogPrimitive.Title className="sr-only">{card.title}</DialogPrimitive.Title>
                <TitleField
                  key={`title-${card.id}`}
                  value={card.title}
                  editable={canEdit}
                  onSave={(title) => patch({ title }, { title })}
                />

                <DecisionBar
                  item={card}
                  viewer={viewer}
                  ownRequest={ownRequest}
                  askedBy={authorName}
                  onAccept={() => work.accept(card.id)}
                  onDecline={() => work.decline(card.id)}
                  onApprove={() => void work.move(card.id, "DONE")}
                  onSendBack={() => work.sendBack(card.id)}
                  onWithdraw={() => setConfirm("withdraw")}
                />
                {outcome?.kind === "declined" && (
                  <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
                    <span className="font-medium">Declined:</span> {outcome.note}
                  </p>
                )}
                {outcome?.kind === "withdrawn" && (
                  <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                    {viewer.side === "CLIENT" ? "You withdrew this request." : "The client withdrew this request."}
                  </p>
                )}

                <dl className="mt-6 grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <Prop icon={UserRound} label={viewer.side === "CLIENT" ? "Pinned to" : "Assignee"}>
                    <AssigneePicker
                      people={people}
                      value={card.assigneeId}
                      disabled={!canEditMeta}
                      onChange={(assigneeId) => patch({ assigneeId }, { assigneeId })}
                    />
                  </Prop>
                  <Prop icon={Flag} label="Priority">
                    <PriorityPicker
                      value={card.priority}
                      disabled={!canEdit}
                      onChange={(priority) => patch({ priority }, { priority })}
                    />
                  </Prop>
                  <Prop icon={CalendarDays} label="Due date">
                    <DueField
                      value={card.dueDate}
                      today={today}
                      done={card.stage === "DONE"}
                      disabled={!canEdit}
                      onChange={(dueDate) => patch({ dueDate }, { dueDate })}
                    />
                  </Prop>
                  {(phases.length > 0 || card.parentId) && (
                    <Prop icon={MilestoneIcon} label="Phase">
                      <MilestonePicker
                        milestones={phases.filter((m) => m.id !== card.id)}
                        value={card.parentId}
                        // A phase with work under it can't go under another;
                        // a request finds its phase when it's accepted.
                        disabled={!canEditMeta || card.childCount > 0 || requested}
                        onChange={(parentId) => patch({ parentId }, { parentId })}
                      />
                    </Prop>
                  )}
                  {showPrice && (
                    <Prop icon={BadgeDollarSign} label="Price">
                      <PriceField
                        item={card}
                        editable={canPrice && !archived}
                        onSave={(pricing) =>
                          patch(
                            { pricing },
                            {
                              pricingType: pricing.pricingType,
                              hourlyRate: pricing.pricingType === "HOURLY" ? (pricing.hourlyRate ?? null) : null,
                              estimatedHours:
                                pricing.pricingType === "HOURLY" ? (pricing.estimatedHours ?? null) : null,
                              fixedPrice: pricing.pricingType === "FIXED" ? (pricing.fixedPrice ?? null) : null,
                            },
                          )
                        }
                      />
                    </Prop>
                  )}
                  {viewer.role === "ADMIN" && card.billedOn.length > 0 && (
                    <Prop icon={ReceiptText} label="Billed">
                      <span className="flex flex-wrap gap-1.5 px-2">
                        {card.billedOn.map((b) => (
                          <Link
                            key={b.invoiceId}
                            href={`/admin/invoices/${b.invoiceId}`}
                            className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-300"
                          >
                            {b.invoiceNumber}
                            {b.status === "DRAFT" ? " · draft" : ""}
                          </Link>
                        ))}
                      </span>
                    </Prop>
                  )}
                  <Prop icon={Clock} label="Created">
                    <span className="flex min-w-0 items-center gap-2 px-2 text-muted-foreground">
                      <PersonAvatar person={author} size={18} />
                      <span className="truncate">
                        {authorName} · {format(new Date(card.createdAt), "MMM d, yyyy")}
                      </span>
                    </span>
                  </Prop>
                </dl>

                <Description
                  key={`details-${card.id}`}
                  loading={!data}
                  value={data?.description ?? null}
                  editable={canEdit}
                  onSave={async (description) => {
                    const ok = await patch({ description }, { hasDescription: hasRichTextContent(description) });
                    if (ok) {
                      await mutate((cur) => (cur ? { ...cur, description } : cur), { revalidate: false });
                    }
                    return !!ok;
                  }}
                />

                {(team || card.loggedHours > 0) && !requested && (
                  <TimeSection
                    item={card}
                    entries={data?.timeEntries ?? null}
                    canLog={team && !archived && !!live}
                    onLog={() => work.logTime(card.id)}
                  />
                )}
              </div>

              {/* Right: the conversation */}
              <div
                className={cn(
                  "flex min-h-0 flex-col border-t bg-muted/30 lg:border-t-0 lg:border-l",
                  pane !== "activity" && "max-lg:hidden",
                )}
              >
                <div className="flex items-center gap-2 px-5 pt-4 pb-2">
                  <MessageSquare className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Comments</h3>
                  {openHelp.length > 0 && (
                    <span className="ml-auto rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
                      {openHelp.length} open help {openHelp.length === 1 ? "request" : "requests"}
                    </span>
                  )}
                </div>
                <CommentList
                  comments={comments}
                  loading={!data}
                  viewer={viewer}
                  onResolve={resolve}
                  onDelete={removeComment}
                />
                {!archived && (
                  <div className="border-t bg-background p-3">
                    <CommentComposer people={people} viewer={viewer} onSubmit={submitComment} />
                  </div>
                )}
              </div>
            </div>
          )}

          <Dialog open={!!confirm} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{confirm === "withdraw" ? "Withdraw this request?" : "Delete this milestone?"}</DialogTitle>
                <DialogDescription>
                  {confirm === "withdraw"
                    ? `“${card?.title}” leaves the plan. The team sees that you withdrew it.`
                    : `“${card?.title}” leaves the list and the board for everyone. If it has logged hours, invoices or comments, it's archived instead, with its history kept.`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="destructive" disabled={busy} onClick={confirmed}>
                  {busy && <Loader2 className="animate-spin" />} {confirm === "withdraw" ? "Withdraw" : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* -------------------------------------------------------------------- */
/* Decisions                                                            */
/* -------------------------------------------------------------------- */

/**
 * The one thing this item is waiting for, and the buttons to give it: the
 * team's decision on a request, the client's verdict on work in review, the
 * client's rating of finished work. Nothing waiting, nothing shown.
 */
function DecisionBar({
  item,
  viewer,
  ownRequest,
  askedBy,
  onAccept,
  onDecline,
  onApprove,
  onSendBack,
  onWithdraw,
}: {
  item: WorkItem;
  viewer: BoardViewer;
  ownRequest: boolean;
  askedBy: string;
  onAccept: () => void;
  onDecline: () => void;
  onApprove: () => void;
  onSendBack: () => void;
  onWithdraw: () => void;
}) {
  if (item.archivedAt) return null;
  const client = viewer.side === "CLIENT";
  const bar = "mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 text-sm";

  if (item.stage === "REQUESTED") {
    if (!client) {
      return (
        <div className={cn(bar, "border-amber-300/60 bg-amber-500/[0.07] dark:border-amber-800/60")}>
          <Inbox className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="min-w-0 flex-1">
            <span className="font-medium">{askedBy} asked for this</span>{" "}
            <span className="text-muted-foreground">
              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })} — accept it into the plan or
              decline it with a note.
            </span>
          </p>
          {item.sourceTaskRequestId && (
            <span className="flex gap-2">
              <Button size="sm" onClick={onAccept}>
                <Check /> Accept
              </Button>
              <Button size="sm" variant="outline" onClick={onDecline}>
                <X /> Decline
              </Button>
            </span>
          )}
        </div>
      );
    }
    return (
      <div className={cn(bar, "border-amber-300/60 bg-amber-500/[0.07] dark:border-amber-800/60")}>
        <Lock className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="min-w-0 flex-1 text-muted-foreground">
          {ownRequest
            ? "Waiting for the team to pick it up — you can still change it, or withdraw it."
            : "Waiting for the team to pick it up."}
        </p>
        {ownRequest && (
          <Button size="sm" variant="outline" onClick={onWithdraw}>
            <Undo2 /> Withdraw
          </Button>
        )}
      </div>
    );
  }

  if (item.stage === "REVIEW" && client) {
    return (
      <div className={cn(bar, "border-violet-300/60 bg-violet-500/[0.07] dark:border-violet-800/60")}>
        <CircleDot className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Ready for your review.</span>{" "}
          <span className="text-muted-foreground">Approve it if it&apos;s right, or send it back with a note.</span>
        </p>
        <span className="flex gap-2">
          <Button size="sm" onClick={onApprove}>
            <Check /> Approve
          </Button>
          <Button size="sm" variant="outline" onClick={onSendBack}>
            <Undo2 /> Send back
          </Button>
        </span>
      </div>
    );
  }

  if (item.stage === "DONE" && client && !item.parentId) {
    return (
      <div className="mt-1">
        <RateMilestone milestoneId={item.id} rating={item.clientRating} note={item.clientRatingNote} />
      </div>
    );
  }

  if (!client && item.stage === "REVIEW") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleDot className="size-3 text-violet-500" /> With the client for review.
      </p>
    );
  }

  if (client && item.stage !== "DONE") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3" />
        The team moves this along — you can comment and ask for help.
      </p>
    );
  }
  return null;
}

/* -------------------------------------------------------------------- */
/* Price and time                                                       */
/* -------------------------------------------------------------------- */

/** The price, and for an admin a click-to-edit form (the same fields as accepting a request). */
function PriceField({
  item,
  editable,
  onSave,
}: {
  item: WorkItem;
  editable: boolean;
  onSave: (pricing: ApprovalPricingInput) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const label = formatPricing(item) ?? "No charge";
  if (!editable) return <span className="block px-2 py-1.5">{label}</span>;
  if (!editing) {
    return (
      <button type="button" className={fieldButton} onClick={() => setEditing(true)}>
        <span className={cn("truncate", item.pricingType === "NONE" && "text-muted-foreground")}>{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    );
  }
  return (
    <PricingEditor
      item={item}
      onCancel={() => setEditing(false)}
      onSave={async (pricing) => {
        const ok = await onSave(pricing);
        if (ok) setEditing(false);
        return ok;
      }}
    />
  );
}

function PricingEditor({
  item,
  onCancel,
  onSave,
}: {
  item: WorkItem;
  onCancel: () => void;
  onSave: (pricing: ApprovalPricingInput) => Promise<boolean>;
}) {
  const form = useForm<ApprovalPricingInput>({
    resolver: zodResolver(approvalPricingSchema),
    defaultValues: {
      pricingType: item.pricingType,
      hourlyRate: item.hourlyRate,
      estimatedHours: item.estimatedHours,
      fixedPrice: item.fixedPrice,
    },
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => onSave(values))} className="space-y-2 py-1">
        <PricingFields form={form} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Save price
          </Button>
        </div>
      </form>
    </Form>
  );
}

/** Hours on the item: the total against the estimate, the latest entries, and (team) a way to log more. */
function TimeSection({
  item,
  entries,
  canLog,
  onLog,
}: {
  item: WorkItem;
  entries: { id: string; date: string; hours: number; note: string | null; userName: string | null }[] | null;
  canLog: boolean;
  onLog: () => void;
}) {
  const { over } = hoursProgress(item.loggedHours, item.estimatedHours);
  const shown = (entries ?? []).slice(0, 5);
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center gap-2">
        <Clock className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Time</h3>
        <span className={cn("text-xs text-muted-foreground tabular-nums", over && "font-medium text-red-600 dark:text-red-400")}>
          {formatHours(item.loggedHours)} logged
          {item.estimatedHours != null ? ` of ${formatHours(item.estimatedHours)} estimated` : ""}
        </span>
        {canLog && (
          <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={onLog}>
            <Plus className="size-3.5" /> Log time
          </Button>
        )}
      </div>
      <HoursBar logged={item.loggedHours} estimate={item.estimatedHours} className="mb-3" />
      {entries === null ? (
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No time logged yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {shown.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-3 py-2 text-sm">
              <span className="w-12 shrink-0 font-semibold tabular-nums">{formatHours(e.hours)}</span>
              <span className="min-w-0 flex-1">
                <span className="text-muted-foreground tabular-nums">{formatDay(e.date)}</span>
                {e.userName && <span className="text-muted-foreground"> · {e.userName}</span>}
                {e.note && <span className="mt-0.5 block whitespace-pre-wrap [overflow-wrap:anywhere]">{e.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* Fields                                                               */
/* -------------------------------------------------------------------- */

function IconButton({
  label,
  onClick,
  children,
  ...rest
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      {...rest}
    >
      {children}
    </button>
  );
}

function Prop({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

const fieldButton =
  "inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors enabled:hover:bg-muted disabled:cursor-default";

function TitleField({
  value,
  editable,
  onSave,
}: {
  value: string;
  editable: boolean;
  onSave: (title: string) => Promise<boolean | undefined>;
}) {
  const [draft, setDraft] = useState(value);
  // The title the draft was taken from. Untouched, the draft follows the live
  // title (a teammate's rename); once typed in, it's the viewer's own.
  const [base, setBase] = useState(value);
  if (value !== base) {
    setBase(value);
    if (draft === base) setDraft(value);
  }
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  if (!editable) {
    return (
      <h2 className="font-heading text-xl leading-snug font-semibold [overflow-wrap:anywhere] sm:text-2xl">
        {value}
      </h2>
    );
  }

  // Only a real edit saves: a focus and blur with nothing typed must not
  // write back a title someone else has since changed.
  function commit() {
    const title = draft.trim();
    if (!title || title === base.trim() || title === value) return setDraft(value);
    void onSave(title.slice(0, 200));
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(value);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
      maxLength={200}
      aria-label="Task title"
      className="font-heading -mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-lg bg-transparent px-2 py-1 text-xl leading-snug font-semibold outline-none transition-colors hover:bg-muted/60 focus:bg-muted/60 sm:text-2xl"
    />
  );
}

function StatusPicker({
  item,
  viewer,
  onChange,
}: {
  item: WorkItem;
  viewer: { side: BoardViewer["side"]; role: WorkRole };
  onChange: (stage: ProjectTaskStatus) => void;
}) {
  const status = item.stage;
  const current = COLUMN_BY_ID[status];
  const label = (c: (typeof BOARD_COLUMNS)[number]) =>
    viewer.side === "CLIENT" ? c.clientLabel : c.label;
  // Only the moves this viewer may make (the server checks the same rule).
  const allowed = new Set(stageChoices(viewer.role, item));
  const options = BOARD_COLUMNS.filter((c) => c.id === status || allowed.has(c.id));
  if (options.length < 2) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
        style={{ background: current.color }}
      >
        <CircleDot className="size-3.5" />
        {label(current)}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-[filter] hover:brightness-110"
          style={{ background: current.color }}
          aria-label={`Status: ${label(current)}. Change status`}
        >
          <CircleDot className="size-3.5" />
          {label(current)}
          <ChevronDown className="size-3.5 opacity-80" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {options.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => onChange(c.id)}>
            <span className="size-2.5 rounded-full" style={{ background: c.color }} />
            <span className="flex-1">{label(c)}</span>
            {c.id === status && <CheckCircle2 className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AssigneePicker({
  people,
  value,
  disabled,
  onChange,
}: {
  people: BoardPerson[];
  value: string | null;
  disabled: boolean;
  onChange: (id: string | null) => void;
}) {
  const person = value ? people.find((p) => p.id === value) : undefined;
  const trigger = (
    <button type="button" className={fieldButton} disabled={disabled}>
      <PersonAvatar person={person} size={22} />
      <span className={cn("truncate", !person && "text-muted-foreground")}>
        {person?.name ?? (disabled ? "Nobody yet" : "Pin someone")}
      </span>
      {!disabled && <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
  if (disabled) return trigger;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-60 overflow-y-auto">
        {people.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => p.id !== value && onChange(p.id)}>
            <PersonAvatar person={p} size={20} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="text-[10px] text-muted-foreground">{p.role === "CLIENT" ? "Client" : "Team"}</span>
          </DropdownMenuItem>
        ))}
        {value && (
          <DropdownMenuItem onSelect={() => onChange(null)} className="text-muted-foreground">
            <X /> Unassign
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityPicker({
  value,
  disabled,
  onChange,
}: {
  value: Priority | null;
  disabled: boolean;
  onChange: (p: Priority | null) => void;
}) {
  const trigger = (
    <button type="button" className={fieldButton} disabled={disabled}>
      {value ? (
        <PriorityFlag priority={value} withLabel className="text-sm" />
      ) : (
        <span className="text-muted-foreground">{disabled ? "None" : "Set priority"}</span>
      )}
      {!disabled && <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
  if (disabled) return trigger;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
          <DropdownMenuItem key={p} onSelect={() => p !== value && onChange(p)}>
            <Flag className="size-4" style={{ color: PRIORITY_META[p].color }} fill="currentColor" />
            {PRIORITY_META[p].label}
          </DropdownMenuItem>
        ))}
        {value && (
          <DropdownMenuItem onSelect={() => onChange(null)} className="text-muted-foreground">
            <X /> Clear
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DueField({
  value,
  today,
  done,
  disabled,
  onChange,
}: {
  value: string | null;
  today: string;
  done: boolean;
  disabled: boolean;
  onChange: (day: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const state = value && !done ? dueState(value, today) : null;
  return (
    <span className="relative flex items-center gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const el = inputRef.current;
          if (!el) return;
          // showPicker opens the native calendar from our own button; older
          // browsers fall back to focusing the (visually hidden) input.
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
        className={cn(
          fieldButton,
          !value && "text-muted-foreground",
          state === "overdue" && "font-medium text-red-600 dark:text-red-400",
          (state === "today" || state === "soon") && "font-medium text-amber-700 dark:text-amber-300",
        )}
      >
        {value ? formatDay(value, today) : disabled ? "No date" : "Set due date"}
        {state === "overdue" && (
          <span className="rounded bg-red-500/10 px-1.5 py-px text-[10px] font-semibold uppercase">Overdue</span>
        )}
        {state === "today" && (
          <span className="rounded bg-amber-500/12 px-1.5 py-px text-[10px] font-semibold uppercase">Today</span>
        )}
      </button>
      <input
        ref={inputRef}
        type="date"
        tabIndex={-1}
        aria-label="Due date"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
      />
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Clear due date"
        >
          <X className="size-3.5" />
        </button>
      )}
    </span>
  );
}

function MilestonePicker({
  milestones,
  value,
  disabled,
  onChange,
}: {
  milestones: BoardPhase[];
  value: string | null;
  disabled: boolean;
  onChange: (id: string | null) => void;
}) {
  const current = value ? milestones.find((m) => m.id === value) : undefined;
  const trigger = (
    <button type="button" className={fieldButton} disabled={disabled}>
      <span className={cn("truncate", !current && "text-muted-foreground")}>
        {current?.title ?? (disabled ? "None" : "Link a milestone")}
      </span>
      {!disabled && <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
  if (disabled) return trigger;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
        {milestones.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => m.id !== value && onChange(m.id)}>
            <MilestoneIcon className="size-4" />
            <span className="truncate">{m.title}</span>
          </DropdownMenuItem>
        ))}
        {value && (
          <DropdownMenuItem onSelect={() => onChange(null)} className="text-muted-foreground">
            <X /> Unlink
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Description({
  value,
  loading,
  editable,
  onSave,
}: {
  value: JSONContent | null;
  loading: boolean;
  editable: boolean;
  onSave: (doc: JSONContent | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<JSONContent | null>(null);
  const [saving, setSaving] = useState(false);
  const has = hasRichTextContent(value);

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center gap-2">
        <AlignLeft className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Details</h3>
        {editable && has && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="size-3" /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <RichTextEditor
            value={draft}
            onChange={setDraft}
            placeholder="Links, screenshots, what done looks like…"
            allowImages
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                const ok = await onSave(draft);
                setSaving(false);
                if (ok) setEditing(false);
              }}
            >
              {saving && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      ) : has ? (
        <div className="rounded-xl border bg-card px-4 py-3">
          <RichTextViewer content={value} />
        </div>
      ) : editable ? (
        <button
          type="button"
          onClick={() => {
            setDraft(null);
            setEditing(true);
          }}
          className="w-full rounded-xl border border-dashed px-4 py-6 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
        >
          Add details — links, screenshots, what &ldquo;done&rdquo; looks like…
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">No details yet.</p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* Comments                                                             */
/* -------------------------------------------------------------------- */

function CommentList({
  comments,
  loading,
  viewer,
  onResolve,
  onDelete,
}: {
  comments: BoardComment[];
  loading: boolean;
  viewer: BoardViewer;
  onResolve: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const count = comments.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  if (loading) {
    return (
      <div className="flex-1 space-y-4 px-5 py-3">
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="size-7 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-2 max-lg:min-h-[40vh]">
      {count === 0 ? (
        <div className="flex h-full min-h-40 flex-col items-center justify-center text-center">
          <MessageSquare className="mb-2 size-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">No comments yet</p>
          <p className="mt-0.5 max-w-60 text-xs text-muted-foreground">
            Ask a question, share a screenshot, or type @ to pin someone on this task.
          </p>
        </div>
      ) : (
        <ul className="space-y-4 pb-2">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} viewer={viewer} onResolve={onResolve} onDelete={onDelete} />
          ))}
        </ul>
      )}
      <div ref={endRef} />
    </div>
  );
}

function CommentItem({
  comment: c,
  viewer,
  onResolve,
  onDelete,
}: {
  comment: BoardComment;
  viewer: BoardViewer;
  onResolve: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const pending = c.id.startsWith(TEMP);
  const mine = c.authorId === viewer.id;
  const help = c.kind === "HELP";
  const open = help && !c.resolvedAt;
  const canDelete = !pending && (mine || viewer.side === "ADMIN");
  const sideLabel =
    c.authorRole === "ADMIN" ? (viewer.side === "CLIENT" ? "Avix team" : null) : viewer.side === "ADMIN" ? "Client" : null;

  return (
    <li className={cn("group/comment flex gap-3", pending && "opacity-60")}>
      <PersonAvatar
        person={{ id: c.authorId ?? c.authorName, name: c.authorName, role: c.authorRole === "CLIENT" ? "CLIENT" : "ADMIN" }}
        size={28}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
          <span className="font-semibold text-foreground">{mine ? "You" : c.authorName}</span>
          {sideLabel && !mine && (
            <span className="rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground">{sideLabel}</span>
          )}
          <time className="text-muted-foreground" dateTime={c.createdAt} title={format(new Date(c.createdAt), "PPp")}>
            {pending ? "sending…" : formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
          </time>
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(c.id)}
              className="ml-auto rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/comment:opacity-100 hover:text-destructive focus-visible:opacity-100"
              aria-label="Delete comment"
              title="Delete comment"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </p>

        <div
          className={cn(
            "mt-1 rounded-xl text-sm leading-relaxed",
            help
              ? open
                ? "border border-red-400/50 bg-red-500/[0.06] px-3 py-2.5"
                : "border border-emerald-500/30 bg-emerald-500/[0.05] px-3 py-2.5"
              : "",
          )}
        >
          {help && (
            <p
              className={cn(
                "mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase",
                open ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {open ? <LifeBuoy className="size-3" /> : <CheckCircle2 className="size-3" />}
              {open ? "Help requested" : "Resolved"}
            </p>
          )}
          {c.body && (
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              <CommentText body={c.body} mentions={c.mentions} meId={viewer.id} />
            </p>
          )}
          {c.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {c.attachments.map((a) => (
                <button
                  key={a.url}
                  type="button"
                  onClick={() => setLightbox(a.url)}
                  className="overflow-hidden rounded-lg border bg-muted transition-shadow hover:shadow-md"
                  aria-label={`View ${a.name}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.name} loading="lazy" className="h-24 w-auto max-w-[12rem] object-cover" />
                </button>
              ))}
            </div>
          )}
          {open && !pending && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2.5 h-7 gap-1.5 rounded-lg bg-background text-xs"
              disabled={resolving}
              onClick={async () => {
                setResolving(true);
                await onResolve(c.id);
                setResolving(false);
              }}
            >
              {resolving ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
              {mine ? "Close request" : "Mark resolved"}
            </Button>
          )}
        </div>
      </div>
      {lightbox && <ImageLightbox src={lightbox} alt="" onClose={() => setLightbox(null)} />}
    </li>
  );
}
