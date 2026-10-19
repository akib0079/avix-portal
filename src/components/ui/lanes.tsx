"use client";

import Link from "next/link";
import type { CSSProperties, Ref } from "react";
import { cn } from "@/lib/utils";
import { LanePill } from "@/components/ui/status-pill";
import { ChevronsLeftRight, ChevronsRightLeft, KanbanSquare, List } from "lucide-react";

/**
 * The project board's column, card and scroller, lifted out so every grouped
 * view in the admin — projects by status, invoices by status, leads by stage,
 * requests by outcome — is built from the same parts and reads as one product.
 *
 * Everything keys off a single `--col` colour (see lib/status-colors): the
 * lane is that hue at 4% over the muted surface, its title is a solid pill,
 * its cards carry it as a hairline on the leading edge and as a warm border
 * on hover, and a drag over the lane rings it. No dnd-kit in here: a board
 * hands its droppable ref in through `bodyRef`, so read-only lanes stay
 * light.
 */

/** Columns share the width on a wide screen, and snap one at a time on a phone. */
export function LaneScroller({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:snap-none sm:px-0 lg:gap-2.5 [scrollbar-width:thin]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Lane({
  color,
  title,
  count,
  meta,
  hint,
  actions,
  collapsed,
  onToggle,
  bodyRef,
  highlight,
  empty,
  footer,
  children,
  className,
}: {
  color: string;
  title: string;
  count?: number;
  /** Beside the count — a lane total, say. */
  meta?: React.ReactNode;
  /** One quiet line under the header explaining what lives here. */
  hint?: string;
  /** Extra header buttons, before the fold toggle. */
  actions?: React.ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  /** A board's droppable ref. Applied to the spine when folded, so a folded lane still takes a drop. */
  bodyRef?: Ref<HTMLDivElement>;
  /** Ring the lane: a card is over it, or it is where the dragged card came from. */
  highlight?: boolean;
  /** Shown in place of cards when there are none. Omit to show nothing. */
  empty?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const style = { "--col": color } as CSSProperties;

  if (collapsed) {
    // A slim spine you can still read, reopen and drop onto.
    return (
      <div
        ref={bodyRef}
        style={style}
        className={cn(
          "flex w-11 shrink-0 snap-start flex-col items-center gap-3 rounded-2xl border bg-muted/40 py-3 transition-colors",
          highlight && "bg-[color-mix(in_oklab,var(--col)_14%,transparent)]",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label={`Expand ${title}`}
          title={`Expand ${title}`}
        >
          <ChevronsLeftRight className="size-4" />
        </button>
        <span className="size-2 rounded-full bg-[var(--col)]" />
        {count !== undefined && <span className="text-xs font-semibold tabular-nums">{count}</span>}
        <span className="text-xs font-semibold tracking-wide whitespace-nowrap text-muted-foreground [writing-mode:vertical-rl]">
          {title}
        </span>
      </div>
    );
  }

  return (
    <section
      style={style}
      aria-label={title}
      className={cn(
        "flex w-[84vw] max-w-[340px] min-w-[240px] shrink-0 snap-center flex-col rounded-2xl border bg-[color-mix(in_oklab,var(--col)_4%,var(--muted))] transition-[background-color,box-shadow] sm:w-auto sm:max-w-none sm:flex-1 sm:basis-0 lg:min-w-[220px]",
        highlight && "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--col)_55%,transparent)]",
        className,
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <LanePill color={color}>{title}</LanePill>
        {count !== undefined && (
          <span className="text-xs font-semibold text-muted-foreground tabular-nums">{count}</span>
        )}
        {meta && (
          <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">{meta}</span>
        )}
        <div className="ml-auto flex shrink-0 items-center">
          {actions}
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              aria-label={`Collapse ${title}`}
              title="Collapse"
            >
              <ChevronsRightLeft className="size-4" />
            </button>
          )}
        </div>
      </header>
      {hint && <p className="-mt-1 px-3 pb-2 text-[11px] leading-snug text-muted-foreground">{hint}</p>}

      <div
        ref={bodyRef}
        className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 sm:max-h-[min(70vh,52rem)] [scrollbar-width:thin]"
      >
        {children}
        {empty}
      </div>
      {footer}
    </section>
  );
}

/** The dashed "nothing here" slot, tinted toward the lane's hue. */
export function LaneEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[color-mix(in_oklab,var(--col)_35%,var(--border))] px-3 py-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * The card face: white on the tinted lane, the lane's hue as a hairline on the
 * leading edge, and a border that warms toward that hue on hover. With `href`
 * the whole card is the link.
 */
export function LaneCard({
  color,
  href,
  overlay,
  ghost,
  className,
  children,
}: {
  /** Overrides the lane's colour for this card (e.g. an overdue invoice). */
  color?: string;
  href?: string;
  /** The copy that follows the pointer while dragging. */
  overlay?: boolean;
  /** The slot a card leaves behind while it travels. */
  ghost?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const classes = cn(
    "group/card relative block overflow-hidden rounded-xl border bg-card p-3 text-left shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color,transform] duration-150",
    !overlay &&
      "hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)]",
    overlay &&
      "rotate-[1.5deg] cursor-grabbing border-[color-mix(in_oklab,var(--col)_55%,var(--border))] shadow-[0_22px_45px_-18px_rgb(15_23_42/0.45)]",
    ghost && "border-dashed opacity-35 shadow-none",
    href && "outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
    className,
  );
  const style = color ? ({ "--col": color } as CSSProperties) : undefined;
  const edge = (
    <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />
  );

  if (href) {
    return (
      <Link href={href} className={classes} style={style}>
        {edge}
        {children}
      </Link>
    );
  }
  return (
    <div className={classes} style={style}>
      {edge}
      {children}
    </div>
  );
}

export type ViewMode = "list" | "board";
export const VIEW_MODES = ["list", "board"] as const;

/** List / Board switch. Pair with useLocalChoice so the choice is remembered per page. */
export function ViewToggle({
  value,
  onChange,
  className,
}: {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  className?: string;
}) {
  const options = [
    { value: "list" as const, label: "List", icon: List },
    { value: "board" as const, label: "Board", icon: KanbanSquare },
  ];
  return (
    <div
      role="group"
      aria-label="View"
      className={cn("inline-flex shrink-0 rounded-lg border bg-card p-0.5", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <o.icon className="size-3.5" />
          {o.label}
        </button>
      ))}
    </div>
  );
}
