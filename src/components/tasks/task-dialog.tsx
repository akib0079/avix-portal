"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { TaskView } from "@/lib/dal/tasks";
import { createTask, updateTask, addSubtask, setSubtaskDone, deleteSubtask } from "@/lib/actions/tasks";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Check, Plus, Trash2, Sparkles } from "lucide-react";

export type TaskTargets = {
  clients: { id: string; name: string }[];
  projects: { id: string; projectName: string }[];
  staff: { id: string; name: string }[];
};

const NONE = "none";

/** ISO instant → the yyyy-mm-dd a date input expects, in local time. */
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export function TaskDialog({
  task,
  open,
  onOpenChange,
  targets,
}: {
  task: TaskView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: TaskTargets;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Keyed on the task, so opening a different one remounts the form with
          fresh initial state. Syncing props into state through an effect is
          the alternative, and this repo's purity rule rejects it — rightly,
          since it renders once with the previous task's values. */}
      <TaskForm
        key={task?.id ?? "new"}
        task={task}
        targets={targets}
        onDone={() => onOpenChange(false)}
      />
    </Dialog>
  );
}

function TaskForm({
  task,
  targets,
  onDone,
}: {
  task: TaskView | null;
  targets: TaskTargets;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(task?.title ?? "");
  const [dueDate, setDueDate] = useState(toDateInput(task?.dueDate ?? null));
  const [priority, setPriority] = useState<string>(task?.priority ?? "MEDIUM");
  const [status, setStatus] = useState<string>(task?.status ?? "TODO");
  const [recurrence, setRecurrence] = useState<string>(task?.recurrence ?? "NONE");
  const [assigneeId, setAssigneeId] = useState(task?.assignee?.id ?? NONE);
  const [clientId, setClientId] = useState(task?.client?.id ?? NONE);
  const [projectId, setProjectId] = useState(task?.project?.id ?? NONE);
  const [newSubtask, setNewSubtask] = useState("");

  function save() {
    startTransition(async () => {
      const input = {
        title,
        dueDate,
        priority: priority as "HIGH" | "MEDIUM" | "LOW",
        status: status as "TODO" | "DOING" | "DONE",
        recurrence: recurrence as "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY",
        assigneeId,
        clientId,
        projectId,
      };
      const res = task ? await updateTask(task.id, input) : await createTask(input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(task ? "Task updated." : "Task added.");
      onDone();
    });
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {task ? "Edit task" : "New task"}
            {task?.origin === "SYSTEM" && (
              <span className="flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-xs font-normal">
                <Sparkles className="size-3" /> created automatically
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="task-due">Due</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <Picker label="Priority" value={priority} onChange={setPriority}
              options={[["HIGH", "High"], ["MEDIUM", "Medium"], ["LOW", "Low"]]} />
            <Picker label="Status" value={status} onChange={setStatus}
              options={[["TODO", "To do"], ["DOING", "In progress"], ["DONE", "Done"]]} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Picker
              label="Repeats"
              value={recurrence}
              onChange={setRecurrence}
              options={[
                ["NONE", "Doesn't repeat"],
                ["DAILY", "Every day"],
                ["WEEKLY", "Every week"],
                ["BIWEEKLY", "Every 2 weeks"],
                ["MONTHLY", "Every month"],
              ]}
            />
            <Picker
              label="Assigned to"
              value={assigneeId}
              onChange={setAssigneeId}
              options={[[NONE, "Nobody"], ...targets.staff.map((s) => [s.id, s.name] as [string, string])]}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Picker
              label="About this client"
              value={clientId}
              onChange={setClientId}
              options={[[NONE, "No client"], ...targets.clients.map((c) => [c.id, c.name] as [string, string])]}
            />
            <Picker
              label="About this project"
              value={projectId}
              onChange={setProjectId}
              options={[
                [NONE, "No project"],
                ...targets.projects.map((p) => [p.id, p.projectName] as [string, string]),
              ]}
            />
          </div>

          {/* Subtasks only exist once the task does — they need its id. */}
          {task && (
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-medium">Checklist</p>
              <ul className="space-y-1">
                {task.subtasks.map((s) => (
                  <li key={s.id} className="group flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={s.done ? `Undo ${s.title}` : `Complete ${s.title}`}
                      onClick={() =>
                        startTransition(async () => {
                          await setSubtaskDone(s.id, !s.done);
                        })
                      }
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        s.done
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {s.done && <Check className="size-2.5" strokeWidth={3} />}
                    </button>
                    <span className={cn("flex-1 text-sm", s.done && "text-muted-foreground line-through")}>
                      {s.title}
                    </span>
                    <button
                      type="button"
                      aria-label={`Delete ${s.title}`}
                      onClick={() => startTransition(async () => void (await deleteSubtask(s.id)))}
                      className="p-1 opacity-100 transition-opacity sm:p-0 sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5 text-muted-foreground hover:text-red-600" />
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = newSubtask.trim();
                  if (!value) return;
                  setNewSubtask("");
                  startTransition(async () => {
                    const res = await addSubtask({ taskId: task.id, title: value });
                    if (!res.ok) toast.error(res.error);
                  });
                }}
              >
                <Input
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  placeholder="Add a step…"
                  className="h-8"
                />
                <Button type="submit" variant="outline" size="sm" disabled={!newSubtask.trim()}>
                  <Plus className="size-3.5" />
                </Button>
              </form>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !title.trim()}>
            {pending ? "Saving…" : task ? "Save changes" : "Add task"}
          </Button>
        </DialogFooter>
    </DialogContent>
  );
}

function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
