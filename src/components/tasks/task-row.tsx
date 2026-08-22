"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toneChip, toneText } from "@/lib/tone";
import type { TaskView } from "@/lib/dal/tasks";
import { setTaskDone, snoozeTask, deleteTask } from "@/lib/actions/tasks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Check,
  MoreHorizontal,
  Clock,
  Trash2,
  Sparkles,
  Repeat,
  ReceiptText,
  FolderKanban,
  Target,
  User as UserIcon,
  ListChecks,
  BellOff,
} from "lucide-react";

const PRIORITY_DOT: Record<TaskView["priority"], string> = {
  HIGH: "bg-red-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-muted-foreground/40",
};

/**
 * One line of the list. The checkbox is the primary control and everything
 * else is secondary — ticking something off should never require aiming.
 */
export function TaskRow({
  task,
  onOpen,
  now,
}: {
  task: TaskView;
  onOpen: (task: TaskView) => void;
  now: number;
}) {
  const [pending, startTransition] = useTransition();
  // Optimistic: the tick must feel instant, and the row animates out on the
  // server round trip anyway.
  const [done, setDone] = useState(task.status === "DONE");

  const overdue = task.dueDate != null && new Date(task.dueDate).getTime() < now && !done;
  const snoozed = task.snoozedUntil != null && new Date(task.snoozedUntil).getTime() > now;
  const subtasksDone = task.subtasks.filter((s) => s.done).length;

  function toggle() {
    const next = !done;
    setDone(next);
    startTransition(async () => {
      const res = await setTaskDone(task.id, next);
      if (!res.ok) {
        setDone(!next);
        toast.error(res.error);
        return;
      }
      if (next && task.recurrence !== "NONE") toast.success("Done — next one scheduled.");
    });
  }

  function snooze(preset: "tomorrow" | "nextWeek" | "nextMonth" | null) {
    startTransition(async () => {
      const res = await snoozeTask(task.id, preset);
      if (!res.ok) toast.error(res.error);
      else toast.success(preset ? "Snoozed." : "Back on the list.");
    });
  }

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        done && "opacity-50",
        overdue ? "border-red-500/30 bg-red-500/[0.03]" : "hover:bg-muted/40",
        pending && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
        className={cn(
          // The box stays 18px, but the tap area grows to ~42px via a
          // pseudo-element. An 18px target is fine for a mouse and far below
          // the ~44px a thumb needs; -inset-3 exactly fills the flex gap, so
          // nothing overlaps the title button beside it.
          "relative mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
          "before:absolute before:-inset-3 before:content-[''] sm:before:hidden",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40 hover:border-primary",
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} />}
      </button>

      <button
        type="button"
        onClick={() => onOpen(task)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex items-center gap-2">
          <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} />
          <span className={cn("truncate text-sm font-medium", done && "line-through")}>
            {task.title}
          </span>
          {task.origin === "SYSTEM" && (
            <Sparkles className="size-3 shrink-0 text-primary" aria-label="Created automatically" />
          )}
          {task.recurrence !== "NONE" && (
            <Repeat className="size-3 shrink-0 text-muted-foreground" aria-label="Repeats" />
          )}
        </span>

        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {task.dueDate && (
            <span className={cn("flex items-center gap-1", overdue && toneText.bad)}>
              <Clock className="size-3" />
              {new Date(task.dueDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
          {snoozed && (
            <span className="flex items-center gap-1">
              <BellOff className="size-3" />
              until{" "}
              {new Date(task.snoozedUntil!).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
          {task.subtasks.length > 0 && (
            <span className="flex items-center gap-1">
              <ListChecks className="size-3" />
              {subtasksDone}/{task.subtasks.length}
            </span>
          )}
          {task.assignee && (
            <span className="flex items-center gap-1">
              <UserIcon className="size-3" />
              {task.assignee.name}
            </span>
          )}
        </span>
      </button>

      {/* Context links jump straight to the thing the task is about. */}
      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        {task.invoice && (
          <ContextChip href={`/admin/invoices/${task.invoice.id}`} icon={ReceiptText}>
            {task.invoice.invoiceNumber}
          </ContextChip>
        )}
        {task.project && (
          <ContextChip href={`/admin/projects/${task.project.id}`} icon={FolderKanban}>
            {task.project.projectName}
          </ContextChip>
        )}
        {task.lead && (
          <ContextChip href={`/admin/leads/${task.lead.id}`} icon={Target}>
            {task.lead.name}
          </ContextChip>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="shrink-0 rounded-md p-2 text-muted-foreground opacity-100 transition-opacity hover:bg-muted focus:opacity-100 sm:p-1 sm:opacity-0 sm:group-hover:opacity-100"
          aria-label="Task actions"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onOpen(task)}>Edit…</DropdownMenuItem>
          <DropdownMenuSeparator />
          {snoozed ? (
            <DropdownMenuItem onClick={() => snooze(null)}>Un-snooze</DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={() => snooze("tomorrow")}>
                Snooze to tomorrow
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => snooze("nextWeek")}>
                Snooze a week
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => snooze("nextMonth")}>
                Snooze a month
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className={toneText.bad}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteTask(task.id);
                if (!res.ok) toast.error(res.error);
              })
            }
          >
            <Trash2 className="mr-2 size-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ContextChip({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "flex max-w-[140px] items-center gap-1 rounded-full px-2 py-0.5 text-xs",
        toneChip.neutral,
        "hover:underline",
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{children}</span>
    </Link>
  );
}
