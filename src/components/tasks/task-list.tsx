"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { TaskView } from "@/lib/dal/tasks";
import { quickAddTask } from "@/lib/actions/tasks";
import { useTaskPrefs } from "@/lib/task-prefs";
import { TaskRow } from "./task-row";
import { TaskDialog, type TaskTargets } from "./task-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, Sparkles, CheckCircle2, SlidersHorizontal, BellOff, Check } from "lucide-react";

/**
 * Columns, left to right, in the order they earn attention.
 *
 * Not chronological: "No date" leads because those are the things you chose to
 * do without committing to a day, and a date-ordered board buries them behind
 * whatever is merely late. Overdue sits third — visible, coloured, but not the
 * first thing your eye lands on every morning.
 */
const COLUMNS = ["No date", "Today", "Overdue", "This week", "Later"] as const;
type Bucket = (typeof COLUMNS)[number];

function bucketOf(task: TaskView, now: number): Bucket {
  if (!task.dueDate) return "No date";
  const due = new Date(task.dueDate).getTime();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const endToday = new Date(start);
  endToday.setDate(endToday.getDate() + 1);
  const endWeek = new Date(start);
  endWeek.setDate(endWeek.getDate() + 7);

  if (due < start.getTime()) return "Overdue";
  if (due < endToday.getTime()) return "Today";
  if (due < endWeek.getTime()) return "This week";
  return "Later";
}

export function TaskList({
  tasks,
  targets,
  now,
}: {
  tasks: TaskView[];
  targets: TaskTargets;
  now: number;
}) {
  const [pending, startTransition] = useTransition();
  const [quick, setQuick] = useState("");
  const [editing, setEditing] = useState<TaskView | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { prefs, set } = useTaskPrefs();

  const { grouped, snoozedCount, autoCount, total } = useMemo(() => {
    const map = new Map<Bucket, TaskView[]>();
    let snoozed = 0;
    let auto = 0;
    let shown = 0;

    for (const t of tasks) {
      const isSnoozed = t.snoozedUntil != null && new Date(t.snoozedUntil).getTime() > now;
      const isAuto = t.origin === "SYSTEM";
      // Counted before filtering, so the toggles can say what they would reveal.
      if (isSnoozed) snoozed++;
      if (isAuto) auto++;

      if (isSnoozed && !prefs.showSnoozed) continue;
      if (isAuto && prefs.hideAuto) continue;

      const b = bucketOf(t, now);
      map.set(b, [...(map.get(b) ?? []), t]);
      shown++;
    }
    return { grouped: map, snoozedCount: snoozed, autoCount: auto, total: shown };
  }, [tasks, now, prefs.showSnoozed, prefs.hideAuto]);

  function submitQuick(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    setQuick("");
    startTransition(async () => {
      const res = await quickAddTask({ title, dueDate: "" });
      if (!res.ok) toast.error(res.error);
    });
  }

  function open(task: TaskView | null) {
    setEditing(task);
    setDialogOpen(true);
  }

  const liveColumns = COLUMNS.filter((c) => (grouped.get(c)?.length ?? 0) > 0);

  return (
    <div>
      {/* Capture first. If adding a task costs a dialog, it doesn't get added. */}
      <form onSubmit={submitQuick} className="mb-4 flex gap-2">
        <Input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Add a task and press Enter…"
          className="h-10"
          aria-label="Quick add a task"
        />
        <Button type="submit" disabled={pending || !quick.trim()} aria-label="Add task">
          <Plus className="size-4 sm:mr-1" />
          <span className="hidden sm:inline">Add</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-label="Add a task with full details"
          onClick={() => open(null)}
        >
          <SlidersHorizontal className="size-4 sm:hidden" />
          <span className="hidden sm:inline">Details…</span>
        </Button>
      </form>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-muted-foreground">
          {total} shown
        </span>
        {autoCount > 0 && (
          <FilterToggle
            active={!prefs.hideAuto}
            onClick={() => set({ hideAuto: !prefs.hideAuto })}
            icon={Sparkles}
          >
            {prefs.hideAuto ? `Show ${autoCount} auto-created` : `Auto-created (${autoCount})`}
          </FilterToggle>
        )}
        {snoozedCount > 0 && (
          <FilterToggle
            active={prefs.showSnoozed}
            onClick={() => set({ showSnoozed: !prefs.showSnoozed })}
            icon={BellOff}
          >
            Snoozed ({snoozedCount})
          </FilterToggle>
        )}
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <CheckCircle2 className="mx-auto mb-3 size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">
            {prefs.hideAuto && autoCount > 0 ? "Nothing of your own left." : "Nothing on the list."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {prefs.hideAuto && autoCount > 0
              ? `${autoCount} auto-created task${autoCount === 1 ? " is" : "s are"} hidden — turn them back on above.`
              : "Add one above, or wait — overdue invoices and due follow-ups show up here on their own."}
          </p>
        </div>
      ) : (
        // Empty buckets are dropped rather than rendered as blank columns, so
        // the board stays dense whatever the filters leave behind.
        <div
          className={cn(
            "grid items-start gap-4",
            liveColumns.length >= 2 && "md:grid-cols-2",
            liveColumns.length >= 3 && "xl:grid-cols-3",
            liveColumns.length >= 4 && "2xl:grid-cols-4",
          )}
        >
          {liveColumns.map((bucket) => {
            const list = grouped.get(bucket)!;
            return (
              <section key={bucket} className="min-w-0">
                <h2
                  className={cn(
                    "mb-2 flex items-baseline gap-1.5 text-xs font-semibold tracking-wide uppercase",
                    bucket === "Overdue"
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground",
                  )}
                >
                  {bucket}
                  <span className="font-normal opacity-60">{list.length}</span>
                </h2>
                <div className="space-y-2">
                  {list.map((task) => (
                    <TaskRow key={task.id} task={task} now={now} onOpen={open} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <TaskDialog
        task={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        targets={targets}
      />
    </div>
  );
}

/** A filter chip that reads as on or off at a glance, not as a link. */
function FilterToggle({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary/30 bg-brand-tint text-foreground"
          : "border-transparent bg-muted text-muted-foreground hover:bg-muted/70",
      )}
    >
      {active ? <Check className="size-3 shrink-0" /> : <Icon className="size-3 shrink-0" />}
      {children}
    </button>
  );
}
