"use client";

import { useState } from "react";
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
} from "lucide-react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function fullLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function MonthGrid({
  monthKey, // "YYYY-MM"
  meetings,
  upcoming,
  clients,
  projects,
}: {
  monthKey: string;
  meetings: MeetingView[];
  upcoming: MeetingView[];
  clients: MeetingClientOption[];
  projects: MeetingProjectOption[];
}) {
  const router = useRouter();
  const [bookOpen, setBookOpen] = useState(false);
  const [bookDate, setBookDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<MeetingView | null>(null);
  const [busy, setBusy] = useState(false);

  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay()); // back to Sunday

  const monthLabel = first.toLocaleString("en-US", { month: "long", year: "numeric" });
  const prev = new Date(year, month - 2, 1);
  const next = new Date(year, month, 1);
  const monthParam = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const byDay = new Map<string, MeetingView[]>();
  for (const m of meetings) {
    const key = ymd(new Date(m.startsAt));
    byDay.set(key, [...(byDay.get(key) ?? []), m]);
  }
  const todayKey = ymd(new Date());

  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    return date;
  });

  async function onCancel(meeting: MeetingView) {
    setBusy(true);
    const result = await cancelMeeting(meeting.id);
    setBusy(false);
    setSelected(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Meeting cancelled — the client has been notified.");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="size-8">
            <Link href={`/admin/calendar?month=${monthParam(prev)}`}>
              <ChevronLeft className="size-4" />
              <span className="sr-only">Previous month</span>
            </Link>
          </Button>
          <h2 className="font-heading min-w-40 text-center text-lg font-semibold">
            {monthLabel}
          </h2>
          <Button asChild variant="ghost" size="icon" className="size-8">
            <Link href={`/admin/calendar?month=${monthParam(next)}`}>
              <ChevronRight className="size-4" />
              <span className="sr-only">Next month</span>
            </Link>
          </Button>
        </div>
        <Button
          onClick={() => {
            setBookDate(null);
            setBookOpen(true);
          }}
        >
          <CalendarPlus /> Book meeting
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-semibold text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, i) => {
            const key = ymd(date);
            const inMonth = date.getMonth() === month - 1;
            const dayMeetings = byDay.get(key) ?? [];
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setBookDate(key);
                  setBookOpen(true);
                }}
                className={cn(
                  "min-h-24 border-r border-b p-1.5 text-left align-top transition-colors last:border-r-0 hover:bg-brand-tint/30",
                  !inMonth && "bg-muted/20 text-muted-foreground",
                  (i + 1) % 7 === 0 && "border-r-0",
                )}
                title="Book a meeting on this day"
              >
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-xs",
                    key === todayKey && "bg-primary font-semibold text-white",
                  )}
                >
                  {date.getDate()}
                </span>
                <div className="mt-1 space-y-1">
                  {dayMeetings.slice(0, 3).map((m) => (
                    <span
                      key={m.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(m);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          setSelected(m);
                        }
                      }}
                      className={cn(
                        "block truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                        m.status === "CANCELLED"
                          ? "bg-muted text-muted-foreground line-through"
                          : "bg-brand-tint text-primary hover:bg-primary hover:text-white",
                      )}
                    >
                      {timeLabel(m.startsAt)} · {m.title}
                    </span>
                  ))}
                  {dayMeetings.length > 3 && (
                    <span className="block px-1.5 text-[10px] text-muted-foreground">
                      +{dayMeetings.length - 3} more
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Upcoming list */}
      <div className="mt-6 rounded-xl border bg-card p-5">
        <h3 className="font-heading text-base font-semibold">Upcoming</h3>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing booked — click a day or “Book meeting”.
          </p>
        ) : (
          <ul className="mt-3 divide-y">
            {upcoming.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setSelected(m)}
                  className="flex w-full items-center gap-3 py-2.5 text-left hover:opacity-80"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-semibold text-primary">
                    {initials(m.clientName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {fullLabel(m.startsAt)} · {m.clientName}
                      {m.projectName ? ` · ${m.projectName}` : ""}
                    </span>
                  </span>
                  {m.meetingUrl && <Video className="size-4 shrink-0 text-primary" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

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
                  {fullLabel(selected.startsAt)} · {selected.durationMins} min ·{" "}
                  {selected.clientName}
                  {selected.projectName ? ` · ${selected.projectName}` : ""}
                  {selected.status === "CANCELLED" && " · CANCELLED"}
                </DialogDescription>
              </DialogHeader>
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
