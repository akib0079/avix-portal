"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { TaskView } from "@/lib/dal/tasks";
import { quickAddTask } from "@/lib/actions/tasks";
import { TaskRow } from "./task-row";
import { TaskDialog, type TaskTargets } from "./task-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, Sparkles, CheckCircle2 } from "lucide-react";

/**
 * Buckets by when, not by stage — the question a personal list has to answer
 * is "what now", and a status column can't answer it.
 */
const BUCKETS = ["Overdue", "Today", "This week", "Later", "No date"] as const;
type Bucket = (typeof BUCKETS)[number];

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
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [editing, setEditing] = useState<TaskView | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { grouped, snoozedCount, systemCount } = useMemo(() => {
    const visible: TaskView[] = [];
    let snoozed = 0;
    let system = 0;
    for (const t of tasks) {
      const isSnoozed = t.snoozedUntil != null && new Date(t.snoozedUntil).getTime() > now;
      if (isSnoozed) snoozed++;
      if (t.origin === "SYSTEM") system++;
      if (!isSnoozed || showSnoozed) visible.push(t);
    }
    const map = new Map<Bucket, TaskView[]>();
    for (const t of visible) {
      const b = bucketOf(t, now);
      map.set(b, [...(map.get(b) ?? []), t]);
    }
    return { grouped: map, snoozedCount: snoozed, systemCount: system };
  }, [tasks, now, showSnoozed]);

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

  const total = Array.from(grouped.values()).reduce((n, list) => n + list.length, 0);

  return (
    <div>
      {/* Capture first. If adding a task costs a dialog, it doesn't get added. */}
      <form onSubmit={submitQuick} className="mb-5 flex gap-2">
        <Input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Add a task and press Enter…"
          className="h-10"
          aria-label="Quick add a task"
        />
        <Button type="submit" disabled={pending || !quick.trim()}>
          <Plus className="mr-1 size-4" /> Add
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          Details…
        </Button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          {total} open task{total === 1 ? "" : "s"}
        </span>
        {systemCount > 0 && (
          <span className="flex items-center gap-1">
            <Sparkles className="size-3 text-primary" />
            {systemCount} created automatically
          </span>
        )}
        {snoozedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowSnoozed((v) => !v)}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {showSnoozed ? "Hide" : "Show"} {snoozedCount} snoozed
          </button>
        )}
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <CheckCircle2 className="mx-auto mb-3 size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">Nothing on the list.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add one above, or wait — overdue invoices and due follow-ups show up here on
            their own.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {BUCKETS.map((bucket) => {
            const list = grouped.get(bucket);
            if (!list || list.length === 0) return null;
            return (
              <section key={bucket}>
                <h2
                  className={cn(
                    "mb-2 text-xs font-semibold tracking-wide uppercase",
                    bucket === "Overdue" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                  )}
                >
                  {bucket} · {list.length}
                </h2>
                <div className="space-y-1.5">
                  {list.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      now={now}
                      onOpen={(t) => {
                        setEditing(t);
                        setDialogOpen(true);
                      }}
                    />
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
