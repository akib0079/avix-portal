"use client";

import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { Priority } from "@prisma/client";
import { PRIORITY_META, type BoardMention, type BoardPerson } from "@/lib/board";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Flag, CalendarDays } from "lucide-react";

/**
 * Small pieces the board, its cards and the task drawer share. Kept free of
 * dnd-kit and the editor so the drawer and dialogs can import them without
 * dragging either along.
 */

const AVATAR_HUES = ["#f65d0b", "#3b82f6", "#8b5cf6", "#10b981", "#ec4899", "#0ea5e9", "#f59e0b", "#14b8a6"];

function hueFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_HUES[Math.abs(h) % AVATAR_HUES.length]!;
}

/** A person as a coloured initials disc. Clients are always slate — it reads as "them" at a glance. */
export function PersonAvatar({
  person,
  size = 24,
  className,
  ring,
}: {
  person: Pick<BoardPerson, "id" | "name" | "role"> | null | undefined;
  size?: number;
  className?: string;
  /** Draws a card-coloured ring so stacked avatars separate. */
  ring?: boolean;
}) {
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(9, Math.round(size * 0.4)),
    background: !person ? undefined : person.role === "CLIENT" ? "#64748b" : hueFor(person.id),
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none",
        !person && "border border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground",
        ring && "ring-2 ring-card",
        className,
      )}
      style={style}
      title={person?.name}
      aria-hidden={!person}
    >
      {person ? initials(person.name) : null}
    </span>
  );
}

export function PriorityFlag({
  priority,
  withLabel = false,
  className,
}: {
  priority: Priority | null;
  withLabel?: boolean;
  className?: string;
}) {
  if (!priority) return null;
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-[11px] font-medium", className)}
      style={{ color: meta.color }}
      title={`${meta.label} priority`}
    >
      <Flag className="size-3" fill="currentColor" />
      {withLabel && meta.label}
    </span>
  );
}

/** Today as "YYYY-MM-DD" in the viewer's own calendar. */
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type DueState = "overdue" | "today" | "soon" | "later";

export function dueState(day: string, today: string): DueState {
  if (day < today) return "overdue";
  if (day === today) return "today";
  const diff = (Date.parse(day) - Date.parse(today)) / 86_400_000;
  return diff <= 3 ? "soon" : "later";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 24", or "Oct 24, 2027" when it isn't this year. */
export function formatDay(day: string, today?: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const label = `${MONTHS[m - 1]} ${d}`;
  return today && today.slice(0, 4) !== day.slice(0, 4) ? `${label}, ${y}` : label;
}

export function DueChip({
  day,
  done,
  today,
  className,
}: {
  day: string | null;
  done?: boolean;
  today: string;
  className?: string;
}) {
  if (!day) return null;
  const state = done ? "later" : dueState(day, today);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap tabular-nums",
        state === "overdue" && "bg-red-500/10 text-red-600 dark:text-red-400",
        state === "today" && "bg-amber-500/12 text-amber-700 dark:text-amber-300",
        state === "soon" && "bg-amber-500/8 text-amber-700 dark:text-amber-300",
        state === "later" && "text-muted-foreground",
        done && "line-through decoration-1",
        className,
      )}
      title={state === "overdue" ? "Overdue" : undefined}
    >
      <CalendarDays className="size-3" />
      {state === "today" ? "Today" : formatDay(day, today)}
    </span>
  );
}

/** Escape a string for use inside a RegExp. */
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const URL_RE = /https?:\/\/[^\s<>"')]+/;

/**
 * A comment body with its @mentions highlighted and bare links made clickable.
 * Plain text in, React nodes out — nothing is ever set as HTML.
 */
export function CommentText({
  body,
  mentions,
  meId,
}: {
  body: string;
  mentions: BoardMention[];
  meId?: string;
}): ReactNode {
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const parts = [URL_RE.source, ...names.map((m) => `@${escapeRe(m.name)}`)];
  const re = new RegExp(`(${parts.join("|")})`, "g");
  const tokens = body.split(re);
  return tokens.map((token, i) => {
    if (!token) return null;
    if (/^https?:\/\//.test(token)) {
      return (
        <a
          key={i}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 [overflow-wrap:anywhere]"
        >
          {token}
        </a>
      );
    }
    const mention = token.startsWith("@") ? names.find((m) => `@${m.name}` === token) : undefined;
    if (mention) {
      return (
        <span
          key={i}
          className={cn(
            "rounded px-1 py-px font-medium",
            mention.id === meId
              ? "bg-primary/15 text-primary"
              : "bg-info/10 text-info dark:text-sky-300",
          )}
        >
          {token}
        </span>
      );
    }
    return <Fragment key={i}>{token}</Fragment>;
  });
}
