"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookMeeting } from "@/lib/actions/booking";
import type { OpenSlot } from "@/lib/dal/availability";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CalendarCheck, Clock, Loader2, CheckCircle2 } from "lucide-react";

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

  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" }),
    [tz],
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }),
    [tz],
  );

  // Group slots by their calendar day in the viewer's timezone.
  const days = useMemo(() => {
    const map = new Map<string, OpenSlot[]>();
    for (const s of slots) {
      const key = dayFmt.format(new Date(s.startIso));
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [slots, dayFmt]);

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
      <div className="flex flex-col items-center gap-3 rounded-xl border py-16 text-center">
        <CheckCircle2 className="size-10 text-emerald-500" />
        <p className="font-heading text-lg font-semibold">You&apos;re booked!</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          We&apos;ve emailed you the details and a calendar invite. See you then.
        </p>
        <Button variant="outline" size="sm" onClick={() => { setDone(false); setSelected(null); setNote(""); }}>
          Book another
        </Button>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center">
        <p className="font-medium">No open times right now</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Please check back later or reach out in chat and we&apos;ll find a time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {days.map(([label, daySlots]) => (
        <div key={label}>
          <h3 className="font-heading mb-2 text-sm font-semibold text-muted-foreground">{label}</h3>
          <div className="flex flex-wrap gap-2">
            {daySlots.map((s) => (
              <button
                key={s.startIso}
                type="button"
                onClick={() => setSelected(s.startIso)}
                className={
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " +
                  (selected === s.startIso
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:border-primary hover:bg-accent")
                }
              >
                {timeFmt.format(new Date(s.startIso))}
              </button>
            ))}
          </div>
        </div>
      ))}

      {selected && (
        <div className="rounded-xl border bg-muted/40 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CalendarCheck className="size-4 text-primary" />
            {dayFmt.format(new Date(selected))} · {timeFmt.format(new Date(selected))}
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
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={confirm} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <CalendarCheck className="size-4" />}
              Confirm booking
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
