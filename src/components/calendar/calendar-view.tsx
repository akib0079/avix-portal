"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MeetingView } from "@/lib/dal/meetings";
import { cancelMeeting } from "@/lib/actions/meetings";
import { googleCalendarUrl } from "@/lib/calendar-links";
import {
  MeetingFormDialog,
  type MeetingClientOption,
  type MeetingProjectOption,
} from "./meeting-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Lane, LaneEmpty, LaneScroller } from "@/components/ui/lanes";
import { HUE } from "@/lib/status-colors";
import { useLocalChoice, useLocalSet } from "@/lib/use-local-pref";
import {
  addDays,
  dayIn,
  dayOfMonth,
  formatDay,
  formatIn,
  mondayOf,
  weekdayMon,
  type DayKey,
} from "@/lib/calendar-days";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Video,
  CalendarDays,
  Download,
  Ban,
  Plus,
  Columns3,
  LayoutGrid,
} from "lucide-react";

const WEEKDAY_IDS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type CalendarMode = "week" | "month";
const MODES = ["week", "month"] as const;

const noopSubscribe = () => () => {};

/**
 * The zone the calendar draws in: the agency's on the server and through
 * hydration, then the admin's own browser zone — the same wall clock the
 * booking form uses. useSyncExternalStore makes that switch after hydration
 * instead of during it, so the first paint never mismatches.
 */
function useDisplayTz(serverTz: string): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || serverTz,
    () => serverTz,
  );
}

function timeRange(m: MeetingView, tz: string): string {
  const end = new Date(new Date(m.startsAt).getTime() + m.durationMins * 60_000).toISOString();
  const opts = { hour: "numeric", minute: "2-digit" } as const;
  return `${formatIn(m.startsAt, tz, opts)} – ${formatIn(end, tz, opts)}`;
}

/** "Oct 19 – 25, 2026", "Oct 26 – Nov 1, 2026", "Dec 28, 2026 – Jan 3, 2027". */
function weekTitle(start: DayKey, end: DayKey): string {
  const md = { month: "short", day: "numeric" } as const;
  const year = end.slice(0, 4);
  if (start.slice(0, 4) !== year) {
    return `${formatDay(start, { ...md, year: "numeric" })} – ${formatDay(end, { ...md, year: "numeric" })}`;
  }
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${formatDay(start, md)} – ${dayOfMonth(end)}, ${year}`;
  }
  return `${formatDay(start, md)} – ${formatDay(end, md)}, ${year}`;
}

function hoursLabel(mins: number): string {
  const h = mins / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/**
 * Calendar, in the board's language. Week is a lane per day — on a phone,
 * one day per swipe, which is the agenda the month grid could never be at
 * 375px. Month is the overview: a dot or chip per call, and tapping a day
 * opens that day's agenda under the grid.
 */
export function CalendarView({
  monthKey,
  weekKey,
  todayKey: serverToday,
  meetings,
  upcoming,
  clients,
  projects,
  serverTimezone,
  renderedAt,
}: {
  /** "YYYY-MM" shown in month mode. */
  monthKey: string;
  /** Monday "YYYY-MM-DD" shown in week mode. */
  weekKey: DayKey;
  /** Today in the agency zone, as the server saw it. */
  todayKey: DayKey;
  meetings: MeetingView[];
  upcoming: MeetingView[];
  clients: MeetingClientOption[];
  projects: MeetingProjectOption[];
  serverTimezone: string;
  renderedAt: number;
}) {
  const router = useRouter();
  const tz = useDisplayTz(serverTimezone);
  const todayKey = tz === serverTimezone ? serverToday : dayIn(new Date(renderedAt), tz);
  const [mode, setMode] = useLocalChoice<CalendarMode>("avix.calendar.view", "week", MODES);
  const [bookOpen, setBookOpen] = useState(false);
  const [bookDate, setBookDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<MeetingView | null>(null);
  const [busy, setBusy] = useState(false);

  // Meetings arrive in start order, so each day's list is already sorted.
  const byDay = new Map<DayKey, MeetingView[]>();
  for (const m of meetings) {
    const key = dayIn(m.startsAt, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), m]);
  }

  function book(day: DayKey | null) {
    setBookDate(day);
    setBookOpen(true);
  }

  async function onCancel(meeting: MeetingView) {
    setBusy(true);
    const result = await cancelMeeting(meeting.id);
    setBusy(false);
    setSelected(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Meeting cancelled — the client has been notified.");
    router.refresh();
  }

  // Navigation
  const [y, mo] = monthKey.split("-").map(Number) as [number, number];
  const monthParam = (offset: number) => {
    const d = new Date(Date.UTC(y, mo - 1 + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const weekEnd = addDays(weekKey, 6);
  const title =
    mode === "month"
      ? formatDay(`${monthKey}-01`, { month: "long", year: "numeric" })
      : weekTitle(weekKey, weekEnd);
  const prevHref =
    mode === "month"
      ? `/admin/calendar?month=${monthParam(-1)}`
      : `/admin/calendar?week=${addDays(weekKey, -7)}`;
  const nextHref =
    mode === "month"
      ? `/admin/calendar?month=${monthParam(1)}`
      : `/admin/calendar?week=${addDays(weekKey, 7)}`;
  const showingToday =
    mode === "month" ? todayKey.slice(0, 7) === monthKey : mondayOf(todayKey) === weekKey;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" className="size-8">
            <Link href={prevHref} aria-label={mode === "month" ? "Previous month" : "Previous week"}>
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <h2 className="title-section min-w-44 text-center tabular-nums">{title}</h2>
          <Button asChild variant="ghost" size="icon" className="size-8">
            <Link href={nextHref} aria-label={mode === "month" ? "Next month" : "Next week"}>
              <ChevronRight className="size-4" />
            </Link>
          </Button>
          {!showingToday && (
            <Button asChild variant="outline" size="sm" className="ml-1 h-8">
              <Link href="/admin/calendar">Today</Link>
            </Button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div role="group" aria-label="View" className="inline-flex rounded-lg border bg-card p-0.5">
            {(
              [
                { value: "week", label: "Week", icon: Columns3 },
                { value: "month", label: "Month", icon: LayoutGrid },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={mode === o.value}
                onClick={() => setMode(o.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  mode === o.value
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <o.icon className="size-3.5" />
                {o.label}
              </button>
            ))}
          </div>
          <Button onClick={() => book(null)}>
            <CalendarPlus /> Book meeting
          </Button>
        </div>
      </div>

      {mode === "week" ? (
        <WeekBoard
          weekKey={weekKey}
          todayKey={todayKey}
          byDay={byDay}
          tz={tz}
          onOpen={setSelected}
          onBook={book}
        />
      ) : (
        <MonthBoard
          monthKey={monthKey}
          todayKey={todayKey}
          byDay={byDay}
          tz={tz}
          onOpen={setSelected}
          onBook={book}
        />
      )}

      {/* Next up — past the visible range too. */}
      <section className="mt-8">
        <h3 className="title-section mb-3">Next up</h3>
        {upcoming.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-card/60 py-8 text-center text-sm text-muted-foreground">
            Nothing booked — pick a day or use “Book meeting”.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            {upcoming.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                tz={tz}
                color={HUE.brand}
                withDay
                onOpen={() => setSelected(m)}
              />
            ))}
          </div>
        )}
      </section>

      <MeetingFormDialog
        clients={clients}
        projects={projects}
        open={bookOpen}
        onOpenChange={setBookOpen}
        defaultDate={bookDate}
      />

      {/* Meeting detail */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading flex items-center gap-2">
                  <CalendarDays className="size-4 text-primary" />
                  {selected.title}
                </DialogTitle>
                <DialogDescription>
                  {formatIn(selected.startsAt, tz, { dateStyle: "full", timeStyle: "short" })} ·{" "}
                  {selected.durationMins} min · {selected.clientName}
                  {selected.projectName ? ` · ${selected.projectName}` : ""}
                  {selected.status === "CANCELLED" && " · CANCELLED"}
                </DialogDescription>
              </DialogHeader>
              {selected.clientTimezone && selected.clientTimezone !== tz && (
                <p className="text-xs text-muted-foreground">
                  For {selected.clientName.split(" ")[0]}:{" "}
                  {formatIn(selected.startsAt, selected.clientTimezone, {
                    weekday: "short",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZoneName: "short",
                  })}
                </p>
              )}
              {selected.notes && (
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {selected.notes}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {selected.meetingUrl && (
                  <Button asChild size="sm">
                    <a href={selected.meetingUrl} target="_blank" rel="noopener noreferrer">
                      <Video /> Join
                    </a>
                  </Button>
                )}
                <Button asChild variant="outline" size="sm">
                  <a
                    href={googleCalendarUrl({
                      id: selected.id,
                      title: selected.title,
                      notes: selected.notes,
                      startsAt: new Date(selected.startsAt),
                      durationMins: selected.durationMins,
                      meetingUrl: selected.meetingUrl,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <CalendarDays /> Google Calendar
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/meetings/${selected.id}/ics`}>
                    <Download /> .ics
                  </a>
                </Button>
              </div>
              {selected.status === "SCHEDULED" && (
                <DialogFooter>
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => onCancel(selected)}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <Ban />}
                    Cancel meeting
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Week                                                                */
/* ------------------------------------------------------------------ */

function laneColor(day: DayKey, todayKey: DayKey): string {
  if (day === todayKey) return HUE.brand;
  if (day < todayKey) return HUE.slate;
  return weekdayMon(day) >= 5 ? HUE.sky : HUE.blue;
}

function WeekBoard({
  weekKey,
  todayKey,
  byDay,
  tz,
  onOpen,
  onBook,
}: {
  weekKey: DayKey;
  todayKey: DayKey;
  byDay: Map<DayKey, MeetingView[]>;
  tz: string;
  onOpen: (m: MeetingView) => void;
  onBook: (day: DayKey) => void;
}) {
  // Weekends start folded; a booked weekend still shows its count on the spine.
  const [folded, toggleFold] = useLocalSet("avix.calendar.folded", ["sat", "sun"]);
  const todayRef = useRef<HTMLDivElement>(null);

  // On a phone the lanes are a swipe each; open on today, not on Monday.
  useEffect(() => {
    const el = todayRef.current;
    if (!el || window.matchMedia("(min-width: 640px)").matches) return;
    el.scrollIntoView({ inline: "start", block: "nearest" });
  }, [weekKey]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekKey, i));

  return (
    <LaneScroller>
      {days.map((day, i) => {
        const id = WEEKDAY_IDS[i]!;
        const list = [...(byDay.get(day) ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        const live = list.filter((m) => m.status === "SCHEDULED");
        const minutes = live.reduce((sum, m) => sum + m.durationMins, 0);
        const past = day < todayKey;
        const color = laneColor(day, todayKey);
        return (
          <Lane
              key={day}
              bodyRef={day === todayKey ? todayRef : undefined}
              color={color}
              title={`${WEEKDAY_SHORT[i]} ${dayOfMonth(day)}${day === todayKey ? " · Today" : ""}`}
              count={live.length}
              hint={minutes > 0 ? `${hoursLabel(minutes)} booked` : undefined}
              collapsed={folded.has(id)}
              onToggle={() => toggleFold(id)}
              actions={
                !past ? (
                  <button
                    type="button"
                    onClick={() => onBook(day)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    aria-label={`Book a meeting on ${formatDay(day, { weekday: "long", month: "long", day: "numeric" })}`}
                    title="Book a meeting"
                  >
                    <Plus className="size-4" />
                  </button>
                ) : undefined
              }
              className={cn("lg:min-w-[170px]", past && "opacity-80")}
              empty={
                list.length === 0 ? (
                  past ? (
                    <LaneEmpty>No calls</LaneEmpty>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onBook(day)}
                      className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[color-mix(in_oklab,var(--col)_35%,var(--border))] px-3 py-6 text-center text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
                    >
                      Free — book a call
                    </button>
                  )
                ) : undefined
              }
            >
              {list.map((m) => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  tz={tz}
                  color={color}
                  past={past}
                  onOpen={() => onOpen(m)}
                />
              ))}
            </Lane>
        );
      })}
    </LaneScroller>
  );
}

function MeetingCard({
  meeting: m,
  tz,
  color,
  past,
  withDay,
  onOpen,
}: {
  meeting: MeetingView;
  tz: string;
  color: string;
  past?: boolean;
  /** Show the date too — for lists that span days. */
  withDay?: boolean;
  onOpen: () => void;
}) {
  const cancelled = m.status === "CANCELLED";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{ "--col": cancelled ? HUE.muted : color } as CSSProperties}
      className={cn(
        "group/card relative cursor-pointer overflow-hidden rounded-xl border bg-card p-3 text-left shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150 outline-none hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)] focus-visible:ring-2 focus-visible:ring-ring/60",
        (past || cancelled) && "opacity-70",
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold text-[color-mix(in_oklab,var(--col)_72%,var(--foreground))] tabular-nums">
          {withDay && `${formatIn(m.startsAt, tz, { weekday: "short", month: "short", day: "numeric" })} · `}
          {timeRange(m, tz)}
        </p>
        {m.meetingUrl && !cancelled && !past && (
          <a
            href={m.meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="-mt-0.5 -mr-1 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-brand-tint"
            title="Join the call"
          >
            <Video className="size-3.5" /> Join
          </a>
        )}
      </div>
      <p
        className={cn(
          "mt-1 line-clamp-2 text-[13px] leading-snug font-semibold [overflow-wrap:anywhere]",
          cancelled && "text-muted-foreground line-through decoration-1",
        )}
      >
        {m.title}
      </p>
      <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-foreground">
          {initials(m.clientName)}
        </span>
        <span className="truncate">
          {m.clientName}
          {m.projectName ? ` · ${m.projectName}` : ""}
        </span>
      </p>
      {cancelled && (
        <span className="mt-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Cancelled
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Month                                                               */
/* ------------------------------------------------------------------ */

function MonthBoard({
  monthKey,
  todayKey,
  byDay,
  tz,
  onOpen,
  onBook,
}: {
  monthKey: string;
  todayKey: DayKey;
  byDay: Map<DayKey, MeetingView[]>;
  tz: string;
  onOpen: (m: MeetingView) => void;
  onBook: (day: DayKey) => void;
}) {
  const first = `${monthKey}-01`;
  const gridStart = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  // Trim a trailing week that is entirely next month.
  const visible = cells.slice(35).every((d) => d.slice(0, 7) !== monthKey) ? cells.slice(0, 35) : cells;
  const [picked, setPicked] = useState<DayKey | null>(null);
  const focusDay = picked && picked.slice(0, 7) === monthKey ? picked : null;
  const agendaDay = focusDay ?? (todayKey.slice(0, 7) === monthKey ? todayKey : null);
  const agenda = agendaDay
    ? [...(byDay.get(agendaDay) ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    : [];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="surface overflow-hidden">
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {WEEKDAY_SHORT.map((d, i) => (
            <div
              key={d}
              className={cn("eyebrow py-2 text-center text-[10px]", i >= 5 && "text-muted-foreground/70")}
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {visible.map((day, i) => {
            const inMonth = day.slice(0, 7) === monthKey;
            const list = byDay.get(day) ?? [];
            const isToday = day === todayKey;
            const isPicked = day === agendaDay;
            const weekend = i % 7 >= 5;
            return (
              <div
                key={day}
                role="button"
                tabIndex={0}
                onClick={() => setPicked(day)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPicked(day);
                  }
                }}
                aria-label={formatDay(day, { weekday: "long", month: "long", day: "numeric" })}
                aria-pressed={isPicked}
                className={cn(
                  "group/day relative min-h-14 cursor-pointer border-r border-b p-1 text-left transition-colors outline-none sm:min-h-28 sm:p-1.5",
                  (i + 1) % 7 === 0 && "border-r-0",
                  !inMonth && "bg-muted/30 text-muted-foreground",
                  inMonth && weekend && "bg-muted/15",
                  isPicked && "bg-[color-mix(in_oklab,var(--brand)_6%,transparent)]",
                  "hover:bg-[color-mix(in_oklab,var(--brand)_5%,transparent)] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                      isToday && "bg-primary font-semibold text-white shadow-sm",
                      !isToday && isPicked && "ring-1 ring-primary/50",
                    )}
                  >
                    {dayOfMonth(day)}
                  </span>
                  {day >= todayKey && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onBook(day);
                      }}
                      className="hidden rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/day:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 sm:block"
                      aria-label="Book a meeting on this day"
                      title="Book a meeting"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>

                {/* Phones: a dot per call — chips can't fit in a 50px cell. */}
                {list.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                    {list.slice(0, 4).map((m) => (
                      <span
                        key={m.id}
                        className={cn(
                          "size-1.5 rounded-full",
                          m.status === "CANCELLED" ? "bg-muted-foreground/40" : "bg-primary",
                        )}
                      />
                    ))}
                  </div>
                )}

                <div className="mt-1 hidden space-y-1 sm:block">
                  {list.slice(0, 3).map((m) => {
                    const cancelled = m.status === "CANCELLED";
                    return (
                      <span
                        key={m.id}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(m);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.stopPropagation();
                            onOpen(m);
                          }
                        }}
                        style={{ "--c": cancelled ? HUE.muted : HUE.brand } as CSSProperties}
                        className={cn(
                          "block truncate rounded-md border-l-2 border-[var(--c)] bg-[color-mix(in_oklab,var(--c)_10%,transparent)] px-1.5 py-0.5 text-[11px] font-medium text-[color-mix(in_oklab,var(--c)_72%,var(--foreground))] transition-colors hover:bg-[color-mix(in_oklab,var(--c)_18%,transparent)]",
                          cancelled && "line-through",
                        )}
                      >
                        {formatIn(m.startsAt, tz, { hour: "numeric", minute: "2-digit" })} · {m.title}
                      </span>
                    );
                  })}
                  {list.length > 3 && (
                    <span className="block px-1.5 text-[10px] text-muted-foreground">
                      +{list.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* The picked day's agenda: the full list a cell can only hint at. */}
      <Lane
        color={agendaDay ? laneColor(agendaDay, todayKey) : HUE.slate}
        title={
          agendaDay
            ? formatDay(agendaDay, { weekday: "short", month: "short", day: "numeric" })
            : "Pick a day"
        }
        count={agendaDay ? agenda.length : undefined}
        actions={
          agendaDay && agendaDay >= todayKey ? (
            <button
              type="button"
              onClick={() => onBook(agendaDay)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              aria-label="Book a meeting on this day"
              title="Book a meeting"
            >
              <Plus className="size-4" />
            </button>
          ) : undefined
        }
        className="w-full max-w-none min-w-0 sm:max-w-none xl:self-start"
        empty={
          agenda.length === 0 ? (
            <LaneEmpty>{agendaDay ? "No calls this day" : "Tap a day to see its calls"}</LaneEmpty>
          ) : undefined
        }
      >
        {agenda.map((m) => (
          <MeetingCard
            key={m.id}
            meeting={m}
            tz={tz}
            color={laneColor(agendaDay!, todayKey)}
            past={agendaDay! < todayKey}
            onOpen={() => onOpen(m)}
          />
        ))}
      </Lane>
    </div>
  );
}
