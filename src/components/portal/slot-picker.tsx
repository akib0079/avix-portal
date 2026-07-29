"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookMeeting } from "@/lib/actions/booking";
import type { OpenSlot } from "@/lib/dal/availability";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  CalendarCheck,
  Clock,
  Loader2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Globe,
  CalendarX2,
} from "lucide-react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Y-M-D key for a date as seen in `tz` — used to bucket slots per calendar day. */
function dayKey(iso: string, tz?: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function SlotPicker({
  slots,
  timezone,
  slotMinutes,
}: {
  slots: OpenSlot[];
  timezone: string | null;
  slotMinutes: number;
}) {
  const router = useRouter();
  const tz = timezone ?? undefined;
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
      }),
    [tz],
  );
  const longDayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    [tz],
  );

  /** Slots bucketed by calendar day (in the viewer's timezone). */
  const byDay = useMemo(() => {
    const map = new Map<string, OpenSlot[]>();
    for (const s of slots) {
      const key = dayKey(s.startIso, tz);
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [slots, tz]);

  const firstAvailableKey = useMemo(() => {
    const keys = [...byDay.keys()].sort();
    return keys[0] ?? null;
  }, [byDay]);

  const [activeDay, setActiveDay] = useState<string | null>(null);
  const selectedDay = activeDay ?? firstAvailableKey;

  // Month the calendar is showing — starts on the first bookable month.
  const [monthOffset, setMonthOffset] = useState(0);
  const baseMonth = useMemo(() => {
    const src = firstAvailableKey ? new Date(`${firstAvailableKey}T12:00:00`) : new Date();
    return new Date(src.getFullYear(), src.getMonth(), 1);
  }, [firstAvailableKey]);
  const viewMonth = useMemo(
    () => new Date(baseMonth.getFullYear(), baseMonth.getMonth() + monthOffset, 1),
    [baseMonth, monthOffset],
  );

  /** Calendar cells for the visible month (leading blanks + day numbers). */
  const cells = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const lead = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: ({ key: string; day: number } | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ key, day: d });
    }
    return out;
  }, [viewMonth]);

  const daySlots = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  function confirm() {
    if (!selected) return;
    startTransition(async () => {
      const res = await bookMeeting(selected, note);
      if (res.ok) {
        setDone(true);
        toast.success("Meeting booked — check your email for the details.");
        router.refresh();
      } else {
        toast.error(res.error);
        setSelected(null);
        router.refresh();
      }
    });
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card py-16 text-center">
        <CheckCircle2 className="size-10 text-emerald-500" />
        <p className="font-heading text-lg font-semibold">You&apos;re booked!</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          We&apos;ve emailed you the details and a calendar invite. See you then.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => {
            setDone(false);
            setSelected(null);
            setNote("");
          }}
        >
          Book another
        </Button>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card py-16 text-center">
        <CalendarX2 className="size-10 text-muted-foreground" />
        <p className="font-heading text-lg font-semibold">No open times right now</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Please check back later, or message us in chat and we&apos;ll find a
          time that works.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_260px]">
        {/* Calendar */}
        <div className="p-5 sm:p-6 md:border-r">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-heading text-base font-semibold">
              {viewMonth.toLocaleString("en-US", { month: "long", year: "numeric" })}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8 rounded-full"
                disabled={monthOffset === 0}
                onClick={() => setMonthOffset((m) => m - 1)}
                aria-label="Previous month"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8 rounded-full"
                onClick={() => setMonthOffset((m) => m + 1)}
                aria-label="Next month"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((d) => (
              <div key={d} className="pb-2 text-[11px] font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {cells.map((cell, i) => {
              if (!cell) return <div key={`b${i}`} />;
              const available = byDay.has(cell.key);
              const isSelected = selectedDay === cell.key;
              return (
                <button
                  key={cell.key}
                  type="button"
                  disabled={!available}
                  onClick={() => {
                    setActiveDay(cell.key);
                    setSelected(null);
                  }}
                  className={cn(
                    "relative mx-auto flex size-10 items-center justify-center rounded-full text-sm transition-colors",
                    isSelected && "bg-primary font-semibold text-primary-foreground",
                    !isSelected && available && "font-medium hover:bg-accent",
                    !available && "cursor-not-allowed text-muted-foreground/40",
                  )}
                >
                  {cell.day}
                  {available && !isSelected && (
                    <span className="absolute bottom-1.5 size-1 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-4 flex items-center gap-1.5 border-t pt-4 text-xs text-muted-foreground">
            <Globe className="size-3.5" />
            Times shown in {tz ?? "UTC"} · {slotMinutes} min slots
          </p>
        </div>

        {/* Times for the chosen day */}
        <div className="border-t p-5 sm:p-6 md:border-t-0">
          <p className="font-heading text-sm font-semibold">
            {selectedDay ? longDayFmt.format(new Date(`${selectedDay}T12:00:00`)) : "Pick a date"}
          </p>
          <div className="mt-3 flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1">
            {daySlots.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No times on this day.
              </p>
            ) : (
              daySlots.map((s) => (
                <button
                  key={s.startIso}
                  type="button"
                  onClick={() => setSelected(s.startIso)}
                  className={cn(
                    "w-full rounded-full border py-2.5 text-sm font-medium transition-colors",
                    selected === s.startIso
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:border-primary hover:bg-accent",
                  )}
                >
                  {timeFmt.format(new Date(s.startIso))}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Confirm bar */}
      {selected && (
        <div className="border-t bg-muted/40 p-5 sm:p-6">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <CalendarCheck className="size-4 text-primary" />
            {longDayFmt.format(new Date(selected))} · {timeFmt.format(new Date(selected))}
            <span className="text-muted-foreground">
              <Clock className="mr-1 inline size-3.5" />
              {slotMinutes} min
            </span>
          </p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Anything you'd like to cover? (optional)"
            className="mt-3 text-sm"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="rounded-full bg-gradient-to-r from-[#fb7a3c] to-[#f65d0b] text-white shadow-md shadow-primary/20 hover:opacity-95"
              onClick={confirm}
              disabled={pending}
            >
              {pending ? <Loader2 className="animate-spin" /> : <CalendarCheck className="size-4" />}
              Confirm booking
            </Button>
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => setSelected(null)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
