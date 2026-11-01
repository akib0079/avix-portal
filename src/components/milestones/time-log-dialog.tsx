"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { timeEntrySchema, type TimeEntryInput } from "@/lib/validation/time-entry";
import {
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
} from "@/lib/actions/time-entries";
import type { PricingType } from "@prisma/client";
import type { TimeEntryView } from "./milestone-types";
import { useWorkItemDetail } from "@/components/board/use-work-item-detail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { formatHours } from "@/lib/work-list";
import { Clock, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

function today(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** What the log needs to know about the item — a list row or a board card both fit. */
type LoggedItem = {
  id: string;
  title: string;
  loggedHours: number;
  pricingType: PricingType;
  estimatedHours: number | null;
  timeEntries?: TimeEntryView[];
};

/**
 * Hours logged on one item: add, correct or remove an entry. The entries
 * come with the item's detail (shared with the drawer, so both stay in step);
 * the totals on the list and the board catch up through `onChanged`.
 */
export function TimeLogDialog({
  milestone,
  open,
  onOpenChange,
  onChanged,
}: {
  milestone: LoggedItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a change lands — the page holding the item refreshes its totals. */
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState<TimeEntryView | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // The list carries no time entries; the recent ones come with the item.
  const detail = useWorkItemDetail(open && milestone ? milestone.id : null);

  const form = useForm<TimeEntryInput>({
    resolver: zodResolver(timeEntrySchema),
    defaultValues: { date: today(), hours: undefined, note: "" },
  });

  function startEdit(entry: TimeEntryView) {
    setEditing(entry);
    form.reset({ date: entry.date, hours: entry.hours, note: entry.note ?? "" });
  }

  function cancelEdit() {
    setEditing(null);
    form.reset({ date: today(), hours: undefined, note: "" });
  }

  async function onSubmit(values: TimeEntryInput) {
    if (!milestone) return;
    const result = editing
      ? await updateTimeEntry(editing.id, values)
      : await createTimeEntry(milestone.id, values);
    if (!result.ok) return void toast.error(result.error);
    toast.success(editing ? "Entry updated." : "Time logged.");
    cancelEdit();
    // The action revalidates the project page itself; no router.refresh(),
    // which would render it a second time.
    void detail.mutate();
    onChanged?.();
  }

  async function onDelete(id: string) {
    setDeletingId(id);
    const result = await deleteTimeEntry(id);
    setDeletingId(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Entry deleted.");
    void detail.mutate();
    onChanged?.();
  }

  const entries = detail.data?.timeEntries ?? milestone?.timeEntries ?? [];
  const total = detail.data?.item.loggedHours ?? milestone?.loggedHours ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) cancelEdit();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            Time log — {milestone?.title}
          </DialogTitle>
          <DialogDescription>
            {total > 0
              ? `${formatHours(total)} logged so far.`
              : "No hours logged yet."}
            {milestone?.pricingType === "HOURLY" && milestone.estimatedHours != null
              ? ` Estimated ${formatHours(milestone.estimatedHours)}.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="rounded-lg border bg-muted/30 p-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hours</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.25"
                        min="0"
                        placeholder="e.g. 2.5"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? undefined : Number(e.target.value),
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem className="mt-3">
                  <FormLabel>Progress note (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="What did you work on? How is it going?"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="mt-3 flex items-center gap-2">
              <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <Loader2 className="animate-spin" />
                ) : editing ? (
                  <Pencil />
                ) : (
                  <Plus />
                )}
                {editing ? "Save entry" : "Log time"}
              </Button>
              {editing && (
                <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>
                  <X /> Cancel
                </Button>
              )}
            </div>
          </form>
        </Form>

        {entries.length > 0 && (
          <ul className="divide-y">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-semibold">{formatHours(entry.hours)}</span>{" "}
                    <span className="text-muted-foreground">
                      · {formatDate(entry.date)}
                    </span>
                  </p>
                  {entry.note && (
                    <p className="mt-0.5 text-sm whitespace-pre-wrap text-muted-foreground">
                      {entry.note}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => startEdit(entry)}
                  >
                    <Pencil className="size-3.5" />
                    <span className="sr-only">Edit entry</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    disabled={deletingId === entry.id}
                    onClick={() => onDelete(entry.id)}
                  >
                    {deletingId === entry.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                    <span className="sr-only">Delete entry</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
