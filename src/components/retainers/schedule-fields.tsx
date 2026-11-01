"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CADENCE_PRESETS,
  anchorDay,
  longDay,
  presetOf,
  shortDay,
  upcomingRuns,
  type CadencePreset,
  type Day,
  type ScheduleUnit,
} from "@/lib/recurring";
import type { ScheduleInput } from "@/lib/validation/retainer";
import { cn } from "@/lib/utils";
import { CalendarClock, FileClock, Send } from "lucide-react";

/** The schedule as the fields hold it: numbers stay "" while they are being typed. */
export type ScheduleDraft = {
  frequency: ScheduleUnit;
  interval: number | "";
  nextDate: Day;
  ends: ScheduleInput["ends"];
  endAfterCount: number | "";
  endDate: string;
  autoSend: boolean;
};

export type ScheduleErrors = Partial<Record<keyof ScheduleInput, string>>;

export function draftFromSchedule(schedule: {
  frequency: ScheduleUnit;
  interval: number;
  nextDate: Day;
  endAfterCount: number | null;
  endDay: Day | null;
  autoSend: boolean;
}): ScheduleDraft {
  return {
    frequency: schedule.frequency,
    interval: schedule.interval,
    nextDate: schedule.nextDate,
    ends: schedule.endAfterCount != null ? "after" : schedule.endDay ? "on" : "never",
    endAfterCount: schedule.endAfterCount ?? "",
    endDate: schedule.endDay ?? "",
    autoSend: schedule.autoSend,
  };
}

/** What the server is sent; the schema has the last word on what is valid. */
export function scheduleInput(draft: ScheduleDraft): ScheduleInput {
  return {
    frequency: draft.frequency,
    interval: draft.interval === "" ? Number.NaN : draft.interval,
    nextDate: draft.nextDate,
    ends: draft.ends,
    endAfterCount:
      draft.ends === "after" ? (draft.endAfterCount === "" ? null : draft.endAfterCount) : null,
    endDate: draft.ends === "on" ? draft.endDate : "",
    autoSend: draft.autoSend,
  };
}

/** A schema error, by field, for the messages under each field. */
export function scheduleErrors(
  issues: { path: PropertyKey[]; message: string }[],
  prefix: PropertyKey[] = [],
): ScheduleErrors {
  const errors: ScheduleErrors = {};
  for (const issue of issues) {
    const matches = prefix.every((key, i) => issue.path[i] === key);
    const field = issue.path[prefix.length] as keyof ScheduleInput | undefined;
    if (matches && field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

/** "Next: 1 Dec, 1 Jan, 1 Feb", from the same calendar the duty runs. */
export function schedulePreview(draft: ScheduleDraft, runCount = 0): Day[] {
  if (draft.interval === "" || !(draft.interval >= 1) || !draft.nextDate) return [];
  return upcomingRuns(
    draft.nextDate,
    { frequency: draft.frequency, interval: draft.interval, dayOfMonth: anchorDay(draft.nextDate) },
    {
      endAfterCount:
        draft.ends === "after" && draft.endAfterCount !== "" ? draft.endAfterCount : null,
      endDay: draft.ends === "on" && draft.endDate ? draft.endDate : null,
      runCount,
    },
    3,
  );
}

function Choice({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-primary bg-brand-tint font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/50",
        className,
      )}
    >
      {children}
    </button>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-destructive">{message}</p>;
}

/**
 * How often a plan's invoices come, the next one's date, where it stops, and
 * whether each one waits as a draft or goes straight to the client, with the
 * dates it will produce. Shared by the plan form, "Make recurring" on an
 * invoice and the Repeat section of a new invoice.
 */
export function ScheduleFields({
  value,
  onChange,
  errors = {},
  today,
  runCount = 0,
  dateLabel = "First invoice on",
  countHint,
}: {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  errors?: ScheduleErrors;
  /** Agency today, which the preview calls "today". */
  today: Day;
  /** Invoices the plan has made, for the preview of a plan that ends. */
  runCount?: number;
  dateLabel?: string;
  /** Under "after N invoices", e.g. that this invoice counts as the first. */
  countHint?: string;
}) {
  const preset: CadencePreset =
    value.interval === "" ? "custom" : presetOf({ frequency: value.frequency, interval: value.interval });
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...value, ...patch });
  const preview = schedulePreview(value, runCount);
  // Half a year or more apart, "1 Dec, 1 Dec" needs its years.
  const dayLabel =
    value.frequency === "MONTH" && value.interval !== "" && value.interval >= 6 ? longDay : shortDay;

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-sm font-medium">How often</p>
        <div className="flex flex-wrap gap-2">
          {CADENCE_PRESETS.map((p) => (
            <Choice
              key={p.id}
              active={preset === p.id}
              onClick={() => set({ frequency: p.frequency, interval: p.interval })}
            >
              {p.label}
            </Choice>
          ))}
          <Choice
            active={preset === "custom"}
            onClick={() =>
              preset !== "custom" &&
              set({ interval: value.frequency === "WEEK" ? 3 : 2 })
            }
          >
            Custom
          </Choice>
        </div>
        {preset === "custom" && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Every</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={value.frequency === "WEEK" ? 52 : 24}
              className="h-9 w-20"
              aria-label="Every how many"
              value={value.interval}
              onChange={(e) =>
                set({ interval: e.target.value === "" ? "" : Math.floor(Number(e.target.value)) })
              }
            />
            <Select
              value={value.frequency}
              onValueChange={(v) => set({ frequency: v as ScheduleUnit })}
            >
              <SelectTrigger className="h-9 w-28" aria-label="Weeks or months">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WEEK">weeks</SelectItem>
                <SelectItem value="MONTH">months</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <FieldError message={errors.interval} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">{dateLabel}</span>
          {/* No min: a plan running behind may keep the date it has, and the
              server says what's wrong with any other past date. A browser
              range check would block the whole form without saying why. */}
          <Input
            type="date"
            value={value.nextDate}
            onChange={(e) => set({ nextDate: e.target.value })}
          />
          <FieldError message={errors.nextDate} />
        </label>

        <div>
          <p className="mb-1.5 text-sm font-medium">Ends</p>
          <div className="flex flex-wrap gap-2">
            <Choice active={value.ends === "never"} onClick={() => set({ ends: "never" })}>
              Never
            </Choice>
            <Choice active={value.ends === "after"} onClick={() => set({ ends: "after" })}>
              After…
            </Choice>
            <Choice active={value.ends === "on"} onClick={() => set({ ends: "on" })}>
              On a date
            </Choice>
          </div>
          {value.ends === "after" && (
            <div className="mt-2">
              <div className="flex items-center gap-2 text-sm">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={520}
                  className="h-9 w-20"
                  aria-label="Number of invoices"
                  value={value.endAfterCount}
                  onChange={(e) =>
                    set({
                      endAfterCount:
                        e.target.value === "" ? "" : Math.floor(Number(e.target.value)),
                    })
                  }
                />
                <span className="text-muted-foreground">invoices</span>
              </div>
              {countHint && <p className="mt-1 text-xs text-muted-foreground">{countHint}</p>}
            </div>
          )}
          {value.ends === "on" && (
            <Input
              type="date"
              className="mt-2"
              aria-label="Last invoice on or before"
              value={value.endDate}
              onChange={(e) => set({ endDate: e.target.value })}
            />
          )}
          <FieldError message={errors.endAfterCount ?? errors.endDate} />
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">When it&apos;s due</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              {
                auto: false,
                icon: FileClock,
                title: "Draft for my review",
                body: "You check it and send it.",
              },
              {
                auto: true,
                icon: Send,
                title: "Send automatically",
                body: "Emailed to the client on its date.",
              },
            ] as const
          ).map((option) => (
            <button
              key={option.title}
              type="button"
              aria-pressed={value.autoSend === option.auto}
              onClick={() => set({ autoSend: option.auto })}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors",
                value.autoSend === option.auto
                  ? "border-primary bg-brand-tint"
                  : "hover:bg-muted/50",
              )}
            >
              <option.icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  value.autoSend === option.auto ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="block text-xs text-muted-foreground">{option.body}</span>
              </span>
            </button>
          ))}
        </div>
        {value.autoSend && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            A period the schedule missed is always left as a draft, never sent on its own.
          </p>
        )}
      </div>

      <p className="flex items-start gap-1.5 rounded-lg bg-muted/60 px-3 py-2 text-sm">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          {preview.length === 0 ? (
            <span className="text-muted-foreground">Pick a date to see the schedule.</span>
          ) : (
            <>
              <span className="text-muted-foreground">Next: </span>
              <span className="font-medium">
                {preview.map((day) => (day === today ? "today" : dayLabel(day))).join(", ")}
              </span>
              {preview.length < 3 && (
                <span className="text-muted-foreground">, then it ends</span>
              )}
            </>
          )}
        </span>
      </p>
    </div>
  );
}
