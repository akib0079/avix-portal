"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  makeInvoiceRecurring,
  setPlanTemplate,
  setRetainerActive,
  skipNextRun,
  updatePlanSchedule,
  type ActionResult,
} from "@/lib/actions/retainers";
import { repeatSchema } from "@/lib/validation/retainer";
import {
  cadenceLabel,
  defaultFirstRun,
  longDay,
  monthsBetween,
  periodVars,
  shiftMonths,
  shortDay,
  withoutMonths,
  type Day,
  type PlanState,
  type ScheduleUnit,
} from "@/lib/recurring";
import { renderPeriodTags } from "@/lib/merge-tags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SoftPill } from "@/components/ui/status-pill";
import { HUE } from "@/lib/status-colors";
import {
  ScheduleFields,
  draftFromSchedule,
  scheduleErrors,
  scheduleInput,
  type ScheduleDraft,
  type ScheduleErrors,
} from "@/components/retainers/schedule-fields";
import { toast } from "sonner";
import {
  AlertTriangle,
  FileStack,
  Loader2,
  PauseCircle,
  Pencil,
  PlayCircle,
  Repeat,
  SkipForward,
} from "lucide-react";

/** The plan an invoice belongs to, as the invoice page shows it. */
export type InvoicePlanView = {
  id: string;
  title: string;
  frequency: ScheduleUnit;
  interval: number;
  state: PlanState;
  autoSend: boolean;
  nextDay: Day | null;
  /** Its run time has come and it hasn't been drafted yet. */
  due: boolean;
  remaining: number | null;
  endAfterCount: number | null;
  endDay: Day | null;
  runCount: number;
  lastRunError: string | null;
  /** This invoice is the one the plan copies. */
  isTemplate: boolean;
  /** What the next invoice's title will be copied from, for the preview. */
  templateTitle: string | null;
  templatePeriod: string | null;
};

type InvoiceFacts = {
  id: string;
  invoiceNumber: string;
  title: string;
  /** "YYYY-MM-DD" */
  issueDay: Day;
  cancelled: boolean;
};

/** "dadad — November 2026" copied for the period of `day`. */
function nextTitle(title: string | null, fromPeriod: string | null, draft: ScheduleDraft): string | null {
  if (!title || !fromPeriod || draft.interval === "" || !draft.nextDate) return null;
  const offset = /^\d{4}-\d{2}$/.test(fromPeriod) ? monthsBetween(fromPeriod, draft.nextDate) : 0;
  const vars = periodVars(draft.nextDate, {
    frequency: draft.frequency,
    interval: draft.interval,
    dayOfMonth: Number(draft.nextDate.slice(8, 10)),
  });
  return renderPeriodTags(shiftMonths(title, offset), vars);
}

/**
 * The invoice page's Repeat card. "Does not repeat" with a way to make it
 * recurring; or, for an invoice on a plan, where the plan stands and the
 * moves that make sense from here (edit, pause or resume, skip the next
 * one, make this the template). A template says that editing it changes
 * every invoice still to come.
 */
export function InvoiceRepeat({
  invoice,
  plan,
  templateFor,
  today,
}: {
  invoice: InvoiceFacts;
  plan: InvoicePlanView | null;
  /** Other plans that copy this invoice without it being one of theirs. */
  templateFor: { id: string; title: string }[];
  today: Day;
}) {
  const [dialog, setDialog] = useState<"make" | "edit" | null>(null);
  const [pending, startTransition] = useTransition();

  // Each action revalidates the invoice pages, so the card redraws itself.
  function run<T>(action: () => Promise<ActionResult<T>>, success: (data: T | undefined) => string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return void toast.error(result.error);
      toast.success(success(result.data));
    });
  }

  const templateBadges = [
    ...(plan?.isTemplate ? [{ id: plan.id, title: plan.title }] : []),
    ...templateFor,
  ];

  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      {plan ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="flex min-w-0 flex-1 items-start gap-2 text-sm">
              <Repeat
                className={
                  plan.state === "active"
                    ? "mt-0.5 size-4 shrink-0 text-primary"
                    : "mt-0.5 size-4 shrink-0 text-muted-foreground"
                }
              />
              <span className="min-w-0">
                Part of{" "}
                <Link href="/admin/retainers" className="font-medium hover:text-primary">
                  “{plan.title}”
                </Link>
                <span className="text-muted-foreground">
                  {" "}
                  · {cadenceLabel(plan)}
                  {plan.state === "ended"
                    ? ` · ended after ${plan.runCount} invoice${plan.runCount === 1 ? "" : "s"}`
                    : plan.state === "paused"
                      ? " · paused"
                      : plan.due
                        ? " · next one due now"
                        : plan.nextDay
                          ? ` · next ${shortDay(plan.nextDay)}`
                          : ""}
                  {plan.state === "active" && plan.remaining != null
                    ? ` · ${plan.remaining} left`
                    : ""}
                </span>
              </span>
            </p>
            <SoftPill color={plan.autoSend ? HUE.green : HUE.slate} className="px-2 text-[10px]">
              {plan.autoSend ? "Sends itself" : "Drafts for review"}
            </SoftPill>
          </div>

          {plan.lastRunError && (
            <p className="flex items-start gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0">{plan.lastRunError}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setDialog("edit")}>
              <Pencil /> Edit
            </Button>
            {plan.state !== "ended" && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setRetainerActive(plan.id, plan.state !== "active"),
                    (data) =>
                      plan.state === "active"
                        ? "Paused. Nothing is drafted until you resume it."
                        : `Resumed.${data?.nextDay ? ` Next invoice ${longDay(data.nextDay)}.` : ""}`,
                  )
                }
              >
                {plan.state === "active" ? <PauseCircle /> : <PlayCircle />}
                {plan.state === "active" ? "Pause" : "Resume"}
              </Button>
            )}
            {plan.state === "active" && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(
                    () => skipNextRun(plan.id),
                    (data) =>
                      !data
                        ? "Skipped."
                        : data.nextDay
                          ? `Skipped ${shortDay(data.skipped)}. Next invoice ${longDay(data.nextDay)}.`
                          : `Skipped ${shortDay(data.skipped)}. That was the last one, so the plan has ended.`,
                  )
                }
              >
                <SkipForward /> Skip next
              </Button>
            )}
            {!plan.isTemplate && !invoice.cancelled && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setPlanTemplate(invoice.id),
                    () => `New invoices of “${plan.title}” now copy ${invoice.invoiceNumber}.`,
                  )
                }
              >
                <FileStack /> Use this as the template
              </Button>
            )}
            {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-muted-foreground">
            <Repeat className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">
              Does not repeat.
              {invoice.cancelled && " A cancelled invoice can't; duplicate it to start a new one."}
            </span>
          </p>
          {!invoice.cancelled && (
            <Button variant="outline" size="sm" onClick={() => setDialog("make")}>
              <Repeat /> Make recurring
            </Button>
          )}
        </div>
      )}

      {templateBadges.map((p) => (
        <p
          key={p.id}
          className="mt-2 flex items-start gap-1.5 rounded-lg bg-[color-mix(in_oklab,var(--brand)_8%,transparent)] px-2.5 py-1.5 text-xs"
        >
          <FileStack className="mt-px size-3.5 shrink-0 text-primary" />
          <span className="min-w-0">
            Template for “{p.title}”: edits change future invoices.
          </span>
        </p>
      ))}

      {dialog && (
        <RepeatDialog
          mode={dialog}
          invoice={invoice}
          plan={plan}
          today={today}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/** "Make recurring", and Edit for an invoice already on a plan. */
function RepeatDialog({
  mode,
  invoice,
  plan,
  today,
  onClose,
}: {
  mode: "make" | "edit";
  invoice: InvoiceFacts;
  plan: InvoicePlanView | null;
  today: Day;
  onClose: () => void;
}) {
  const editing = mode === "edit" && plan;
  const [title, setTitle] = useState(() =>
    editing ? plan.title : withoutMonths(invoice.title) || `Recurring ${invoice.invoiceNumber}`,
  );
  const [schedule, setSchedule] = useState<ScheduleDraft>(() =>
    editing
      ? draftFromSchedule({
          frequency: plan.frequency,
          interval: plan.interval,
          nextDate: plan.nextDay ?? today,
          endAfterCount: plan.endAfterCount,
          endDay: plan.endDay,
          autoSend: plan.autoSend,
        })
      : {
          frequency: "MONTH",
          interval: 1,
          nextDate: defaultFirstRun(invoice.issueDay, { frequency: "MONTH", interval: 1 }, today),
          ends: "never",
          endAfterCount: "",
          endDate: "",
          autoSend: false,
        },
  );
  // Until the date is picked by hand it follows the cadence: a period after
  // the invoice, never in the past.
  const [dateTouched, setDateTouched] = useState(!!editing);
  const [errors, setErrors] = useState<ScheduleErrors & { title?: string }>({});
  const [saving, setSaving] = useState(false);

  function change(next: ScheduleDraft) {
    if (next.nextDate !== schedule.nextDate) setDateTouched(true);
    else if (
      !dateTouched &&
      next.interval !== "" &&
      (next.frequency !== schedule.frequency || next.interval !== schedule.interval)
    ) {
      next = {
        ...next,
        nextDate: defaultFirstRun(
          invoice.issueDay,
          { frequency: next.frequency, interval: next.interval },
          today,
        ),
      };
    }
    setSchedule(next);
  }

  const preview = editing
    ? nextTitle(plan.templateTitle, plan.templatePeriod, schedule)
    : nextTitle(invoice.title, invoice.issueDay.slice(0, 7), schedule);

  async function save() {
    const parsed = repeatSchema.safeParse({ title, schedule: scheduleInput(schedule) });
    if (!parsed.success) {
      const issues = parsed.error.issues;
      return void setErrors({
        ...scheduleErrors(issues, ["schedule"]),
        title: issues.find((i) => i.path[0] === "title")?.message,
      });
    }
    setErrors({});
    setSaving(true);
    const result = editing
      ? await updatePlanSchedule(plan.id, parsed.data)
      : await makeInvoiceRecurring(invoice.id, parsed.data);
    setSaving(false);
    if (!result.ok) return void toast.error(result.error);
    const { schedule: saved } = parsed.data;
    toast.success(
      editing
        ? "Schedule saved."
        : `${invoice.invoiceNumber} now repeats ${cadenceLabel(saved).toLowerCase()}. First new invoice ${longDay(saved.nextDate)}.`,
    );
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {editing ? "Edit repeat" : `Make ${invoice.invoiceNumber} recurring`}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Changes apply to the invoices still to come."
              : "Each new invoice copies this one: its lines, tax, notes and bank details, with its dates and months moved on to the new period."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Plan name</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monthly maintenance" />
            {errors.title && (
              <p className="mt-1 text-xs font-medium text-destructive">{errors.title}</p>
            )}
          </label>
          <ScheduleFields
            value={schedule}
            onChange={change}
            errors={errors}
            today={today}
            runCount={editing ? plan.runCount : 1}
            dateLabel={editing ? "Next invoice on" : "First new invoice on"}
            countHint={
              editing
                ? `${plan.runCount} made so far count toward this.`
                : `${invoice.invoiceNumber} counts as the first.`
            }
          />
          {preview && (
            <p className="text-xs text-muted-foreground">
              The next one will be titled{" "}
              <span className="font-medium text-foreground">“{preview}”</span>.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {editing ? "Save" : "Make recurring"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
