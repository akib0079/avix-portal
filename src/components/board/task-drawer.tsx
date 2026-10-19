"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import useSWR from "swr";
import { formatDistanceToNow, format } from "date-fns";
import type { JSONContent } from "@tiptap/react";
import type { Priority, ProjectTaskStatus } from "@prisma/client";
import { Dialog as DialogPrimitive } from "radix-ui";
import { toast } from "sonner";
import {
  BOARD_COLUMNS,
  COLUMN_BY_ID,
  PRIORITY_META,
  type BoardCard,
  type BoardComment,
  type BoardMilestone,
  type BoardPerson,
  type BoardTaskDetail,
} from "@/lib/board";
import {
  addBoardComment,
  deleteBoardComment,
  deleteBoardTask,
  resolveBoardHelp,
  updateBoardTask,
} from "@/lib/actions/project-board";
import { RichTextEditor } from "@/components/editor/rich-text-editor-lazy";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { ImageLightbox } from "@/components/editor/image-lightbox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { CommentText, PersonAvatar, PriorityFlag, dueState, formatDay } from "./board-bits";
import type { BoardViewer } from "./project-board";
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
} from "lucide-react";

const fetcher = (url: string) =>
  fetch(url).then((r) => (r.ok ? (r.json() as Promise<BoardTaskDetail>) : null));

const TEMP = "temp-comment-";

/**
 * A card, opened. Right-side panel in the monday mould — the board stays in
 * view beside it — split ClickUp-style into the task on the left and its
 * conversation on the right. On a phone the two halves become tabs.
 */
export function TaskDrawer({
  taskId,
  card: boardCard,
  viewer,
  people,
  milestones,
  today,
  onClose,
  onCardChange,
  onCardDelete,
  onMove,
  track,
}: {
  taskId: string;
  /** The board's copy, for an instant first paint. Null on a deep link it hasn't loaded. */
  card: BoardCard | null;
  viewer: BoardViewer;
  people: BoardPerson[];
  milestones: BoardMilestone[];
  today: string;
  onClose: () => void;
  onCardChange: (card: BoardCard) => void;
  onCardDelete: (id: string) => void;
  onMove: (id: string, status: ProjectTaskStatus) => Promise<void>;
  track: <T>(work: () => Promise<T>) => Promise<T>;
}) {
  const { data, mutate, isLoading } = useSWR<BoardTaskDetail | null>(
    `/api/board-tasks/${taskId}`,
    fetcher,
    { refreshInterval: 12_000, revalidateOnFocus: true },
  );
  const card = boardCard ?? data?.card ?? null;
  // On a phone the halves are tabs; a card waiting on this viewer's answer
  // opens on the conversation, where the question is.
  const [pane, setPane] = useState<"details" | "activity">(() =>
    boardCard?.helpFrom && boardCard.helpFrom !== viewer.side ? "activity" : "details",
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // A link to a card that's gone (deleted, or never this viewer's) closes
  // itself instead of showing an empty panel forever.
  useEffect(() => {
    if (!isLoading && data === null && !boardCard) {
      toast.error("That task isn't on this board any more.");
      onClose();
    }
  }, [isLoading, data, boardCard, onClose]);

  const canEdit = !!card && (viewer.side === "ADMIN" || card.createdById === viewer.id);
  const comments = data?.comments ?? [];
  const openHelp = comments.filter((c) => c.kind === "HELP" && !c.resolvedAt);

  async function patch(
    change: Parameters<typeof updateBoardTask>[1],
    optimistic: Partial<BoardCard>,
  ) {
    if (!card) return;
    const before = card;
    onCardChange({ ...before, ...optimistic });
    const result = await track(() => updateBoardTask(card.id, change));
    if (!result.ok) {
      onCardChange(before);
      toast.error(result.error);
      return false;
    }
    onCardChange(result.data.card);
    return true;
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
    const result = await track(() => addBoardComment({ taskId: card.id, ...draft }));
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
              card: result.data.card,
              comments: cur.comments.map((c) => (c.id === tempId ? result.data.comment : c)),
            }
          : cur,
      { revalidate: false },
    );
    onCardChange(result.data.card);
    if (draft.kind === "HELP") {
      toast.success(viewer.side === "CLIENT" ? "Help requested — the team has been notified." : "Sent to the client.");
    }
    return true;
  }

  async function resolve(commentId: string) {
    const result = await track(() => resolveBoardHelp(commentId));
    if (!result.ok) return void toast.error(result.error);
    await mutate(
      (cur) =>
        cur
          ? {
              ...cur,
              card: result.data.card,
              comments: cur.comments.map((c) => (c.id === commentId ? result.data.comment : c)),
            }
          : cur,
      { revalidate: false },
    );
    onCardChange(result.data.card);
  }

  async function removeComment(commentId: string) {
    const previous = data;
    await mutate(
      (cur) => (cur ? { ...cur, comments: cur.comments.filter((c) => c.id !== commentId) } : cur),
      { revalidate: false },
    );
    const result = await track(() => deleteBoardComment(commentId));
    if (!result.ok) {
      await mutate(previous, { revalidate: false });
      return void toast.error(result.error);
    }
    onCardChange(result.data.card);
  }

  async function removeTask() {
    if (!card) return;
    setDeleting(true);
    const result = await track(() => deleteBoardTask(card.id));
    setDeleting(false);
    if (!result.ok) return void toast.error(result.error);
    setConfirmDelete(false);
    toast.success("Task deleted.");
    onCardDelete(card.id);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied.");
    } catch {
      toast.error("This browser wouldn't let me copy that.");
    }
  }

  const column = card ? COLUMN_BY_ID[card.status] : null;
  const author = card?.createdById ? people.find((p) => p.id === card.createdById) : undefined;

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
                status={card.status}
                side={viewer.side}
                onChange={(status) => status !== card.status && void onMove(card.id, status)}
              />
            )}
            {card?.helpFrom && (
              <span className="hidden items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-600 sm:inline-flex dark:text-red-400">
                <LifeBuoy className="size-3" />
                {card.helpFrom === viewer.side ? "Waiting for an answer" : "Needs your answer"}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <IconButton label="Copy link to this task" onClick={copyLink}>
                <Link2 className="size-4" />
              </IconButton>
              {canEdit && (
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
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                      <Trash2 /> Delete task
                    </DropdownMenuItem>
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
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading task…
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
              {/* Left: the task */}
              <div className={cn("min-h-0 overflow-y-auto px-4 py-5 sm:px-8 sm:py-6", pane !== "details" && "max-lg:hidden")}>
                <DialogPrimitive.Title className="sr-only">{card.title}</DialogPrimitive.Title>
                <TitleField
                  key={`title-${card.id}`}
                  value={card.title}
                  editable={canEdit}
                  onSave={(title) => patch({ title }, { title })}
                />

                {!canEdit && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3" /> Added by the team — you can move it, comment and ask for help.
                  </p>
                )}

                <dl className="mt-6 grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <Prop icon={UserRound} label={viewer.side === "CLIENT" ? "Pinned to" : "Assignee"}>
                    <AssigneePicker
                      people={people}
                      value={card.assigneeId}
                      disabled={!canEdit}
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
                      done={card.status === "DONE"}
                      disabled={!canEdit}
                      onChange={(dueDate) => patch({ dueDate }, { dueDate })}
                    />
                  </Prop>
                  {(milestones.length > 0 || card.milestoneId) && (
                    <Prop icon={MilestoneIcon} label="Milestone">
                      <MilestonePicker
                        milestones={milestones}
                        value={card.milestoneId}
                        disabled={!canEdit}
                        onChange={(milestoneId) => patch({ milestoneId }, { milestoneId })}
                      />
                    </Prop>
                  )}
                  <Prop icon={Clock} label="Created">
                    <span className="flex min-w-0 items-center gap-2 px-2 text-muted-foreground">
                      <PersonAvatar person={author} size={18} />
                      <span className="truncate">
                        {author?.name ?? (card.createdByRole === "CLIENT" ? "Client" : "Avix Digital")} ·{" "}
                        {format(new Date(card.createdAt), "MMM d, yyyy")}
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
                <div className="border-t bg-background p-3">
                  <CommentComposer people={people} viewer={viewer} onSubmit={submitComment} />
                </div>
              </div>
            </div>
          )}

          <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this task?</DialogTitle>
                <DialogDescription>
                  “{card?.title}” and its comments are removed for everyone. This can&apos;t be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" disabled={deleting} onClick={removeTask}>
                  {deleting && <Loader2 className="animate-spin" />} Delete task
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

  function commit() {
    const title = draft.trim();
    if (!title) return setDraft(value);
    if (title !== value) void onSave(title.slice(0, 200));
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
  status,
  side,
  onChange,
}: {
  status: ProjectTaskStatus;
  side: "ADMIN" | "CLIENT";
  onChange: (status: ProjectTaskStatus) => void;
}) {
  const current = COLUMN_BY_ID[status];
  const label = (c: (typeof BOARD_COLUMNS)[number]) => (side === "CLIENT" ? c.clientLabel : c.label);
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
        {BOARD_COLUMNS.map((c) => (
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
  milestones: BoardMilestone[];
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
