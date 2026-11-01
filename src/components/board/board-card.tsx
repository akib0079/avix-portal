"use client";

import { memo, type CSSProperties, type SyntheticEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardPerson, BoardPhase, BoardSide, WorkItem, WorkRole } from "@/lib/board";
import { COLUMN_BY_ID } from "@/lib/board";
import { formatHours, priceLabel, stageChoices } from "@/lib/work-list";
import { cn } from "@/lib/utils";
import { HoursBar, PersonAvatar, PriorityFlag, DueChip } from "./board-bits";
import { MessageSquare, AlignLeft, LifeBuoy, Loader2, Check, X, Clock } from "lucide-react";

export type CardContext = {
  peopleById: Map<string, BoardPerson>;
  phasesById: Map<string, BoardPhase>;
  viewer: { id: string; side: BoardSide; role: WorkRole };
  today: string;
  /** Price chips: the admin's, on a project with per-item pricing. */
  showPrice: boolean;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
};

/** Keeps a click on a card's own button from opening the card or picking it up. */
function hold(e: SyntheticEvent) {
  e.stopPropagation();
}

/**
 * One card. Memoised on the card object itself: the board keeps unchanged
 * cards referentially identical across polls and drags, so a move re-renders
 * the one card that moved rather than all of them.
 */
export const CardFace = memo(function CardFace({
  card,
  ctx,
  overlay,
}: {
  card: WorkItem;
  ctx: CardContext;
  /** The copy that follows the pointer while dragging. */
  overlay?: boolean;
}) {
  const assignee = card.assigneeId ? ctx.peopleById.get(card.assigneeId) : undefined;
  const phase = card.parentId ? ctx.phasesById.get(card.parentId) : undefined;
  const done = card.stage === "DONE";
  const pending = card.id.startsWith("temp-");
  const team = ctx.viewer.side === "ADMIN";
  // Help the viewer owes an answer to — the loud version. Help they asked for
  // themselves is shown quietly: they already know.
  const helpForMe = card.helpFrom && card.helpFrom !== ctx.viewer.side;
  const fromOtherSide = card.createdByRole !== ctx.viewer.side;
  const column = COLUMN_BY_ID[card.stage];
  const price = ctx.showPrice ? priceLabel(card) : null;
  const decide = team && card.stage === "REQUESTED" && !!card.sourceTaskRequestId && !pending && !overlay;

  return (
    <div
      className={cn(
        "group/card relative overflow-hidden rounded-xl border bg-card p-3 text-left shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color,transform] duration-150",
        !overlay && "hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)]",
        overlay && "rotate-[1.5deg] cursor-grabbing border-[color-mix(in_oklab,var(--col)_55%,var(--border))] shadow-[0_22px_45px_-18px_rgb(15_23_42/0.45)]",
        helpForMe && "border-red-400/60 ring-1 ring-red-400/40",
        pending && "opacity-70",
      )}
      style={{ "--col": column.color } as CSSProperties}
    >
      {/* Column colour, as a hairline on the leading edge. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />

      {(phase || card.helpFrom) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {card.helpFrom && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                helpForMe
                  ? "bg-red-500/12 text-red-600 dark:text-red-400"
                  : "bg-amber-500/12 text-amber-700 dark:text-amber-300",
              )}
            >
              <LifeBuoy className="size-3" />
              {helpForMe
                ? card.helpFrom === "CLIENT"
                  ? "Needs help"
                  : "Needs your input"
                : "Help asked"}
            </span>
          )}
          {phase && (
            <span
              className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              title={`Part of ${phase.title}`}
            >
              {phase.title}
            </span>
          )}
        </div>
      )}

      <p
        className={cn(
          "line-clamp-3 text-[13px] leading-snug font-medium text-foreground [overflow-wrap:anywhere]",
          done && "text-muted-foreground line-through decoration-1",
        )}
      >
        {card.title}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <PriorityFlag priority={card.priority} />
        <DueChip day={card.dueDate} done={done} today={ctx.today} />
        {price && (
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
            {price}
          </span>
        )}
        {team && card.loggedHours > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            <Clock className="size-3" />
            {formatHours(card.loggedHours)}
            {card.estimatedHours != null ? `/${formatHours(card.estimatedHours)}` : ""}
          </span>
        )}
        {card.hasDescription && (
          <AlignLeft className="size-3.5 text-muted-foreground" aria-label="Has details" />
        )}
        {card.commentCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            <MessageSquare className="size-3" />
            {card.commentCount}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {fromOtherSide && !pending && (
            <span className="text-[10px] font-medium whitespace-nowrap text-muted-foreground">
              {card.createdByRole === "CLIENT" ? "From client" : "From team"}
            </span>
          )}
          {assignee && <PersonAvatar person={assignee} size={22} />}
        </span>
      </div>

      {team && <HoursBar logged={card.loggedHours} estimate={card.estimatedHours} className="mt-2.5" />}

      {decide && (
        // A request is decided from its card: one click to accept (the dialog
        // asks where it starts), one to decline (it asks why).
        <div
          className="mt-2.5 flex gap-1.5 border-t pt-2.5"
          onClick={hold}
          onKeyDown={hold}
          onPointerDown={hold}
          onMouseDown={hold}
          onTouchStart={hold}
        >
          <button
            type="button"
            onClick={() => ctx.onAccept(card.id)}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
          >
            <Check className="size-3.5" /> Accept
          </button>
          <button
            type="button"
            onClick={() => ctx.onDecline(card.id)}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border bg-background px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" /> Decline
          </button>
        </div>
      )}
    </div>
  );
});

/**
 * A card the board can drag. Click (or Enter) opens it. Only cards this
 * viewer may move can be picked up (see canMoveWorkItem): a client's work in
 * review, anything else of the team's — so nothing lifts under the pointer
 * only to bounce back.
 */
export const SortableCard = memo(function SortableCard({
  card,
  ctx,
  onOpen,
}: {
  card: WorkItem;
  ctx: CardContext;
  onOpen: (id: string) => void;
}) {
  const pending = card.id.startsWith("temp-");
  // The team can always reorder within a column; a client only lifts what
  // has somewhere to go.
  const movable = ctx.viewer.side === "ADMIN" || stageChoices(ctx.viewer.role, card).length > 0;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { stage: card.stage },
    disabled: pending || !movable,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={`${card.title} — open`}
      onClick={() => !pending && onOpen(card.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isDragging && !pending) {
          e.preventDefault();
          onOpen(card.id);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      className={cn(
        "cursor-pointer touch-manipulation rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        // The slot the card left behind while it travels.
        isDragging && "opacity-35 [&>div]:border-dashed [&>div]:shadow-none",
      )}
    >
      <CardFace card={card} ctx={ctx} />
    </div>
  );
});
