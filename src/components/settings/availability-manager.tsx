"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAvailability } from "@/lib/actions/availability";
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
import { toast } from "sonner";
import { CalendarClock, Plus, Trash2, Loader2 } from "lucide-react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minToTime(min: number) {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}
function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

type Row = { weekday: number; start: string; end: string };

export function AvailabilityManager({
  timezone,
  slotMinutes,
  bookingUrl,
  windows,
}: {
  timezone: string;
  slotMinutes: number;
  bookingUrl: string | null;
  windows: { weekday: number; startMin: number; endMin: number }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tz, setTz] = useState(timezone);
  const [slot, setSlot] = useState(String(slotMinutes));
  const [url, setUrl] = useState(bookingUrl ?? "");
  const [rows, setRows] = useState<Row[]>(
    windows.length
      ? windows.map((w) => ({ weekday: w.weekday, start: minToTime(w.startMin), end: minToTime(w.endMin) }))
      : [{ weekday: 1, start: "09:00", end: "17:00" }],
  );

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { weekday: 1, start: "09:00", end: "17:00" }]);
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  function save() {
    for (const r of rows) {
      if (timeToMin(r.start) >= timeToMin(r.end)) {
        toast.error("Each window's start must be before its end.");
        return;
      }
    }
    startTransition(async () => {
      const res = await saveAvailability({
        agencyTimezone: tz.trim(),
        slotMinutes: Number(slot),
        bookingUrl: url,
        windows: rows.map((r) => ({
          weekday: r.weekday,
          startMin: timeToMin(r.start),
          endMin: timeToMin(r.end),
        })),
      });
      if (res.ok) {
        toast.success("Availability saved.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div>
      <h2 className="font-heading flex items-center gap-2 text-lg font-semibold">
        <CalendarClock className="size-5 text-primary" /> Client booking availability
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Weekly windows when clients can self-book meetings. Times are in your
        agency timezone; clients see slots in their own.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="agency-tz">Agency timezone (IANA)</Label>
          <Input
            id="agency-tz"
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder="America/New_York"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="slot-min">Slot length (min)</Label>
          <Input
            id="slot-min"
            type="number"
            min={10}
            max={240}
            step={5}
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booking-url">Meeting link (optional)</Label>
          <Input
            id="booking-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://meet.google.com/…"
          />
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select
              value={String(r.weekday)}
              onValueChange={(v) => update(i, { weekday: Number(v) })}
            >
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((d, idx) => (
                  <SelectItem key={idx} value={String(idx)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="time"
              value={r.start}
              onChange={(e) => update(i, { start: e.target.value })}
              className="w-[120px]"
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="time"
              value={r.end}
              onChange={(e) => update(i, { end: e.target.value })}
              className="w-[120px]"
            />
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => removeRow(i)}
              aria-label="Remove window"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="size-4" /> Add window
        </Button>
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null} Save availability
        </Button>
      </div>
    </div>
  );
}
