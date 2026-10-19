"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Clock, MoonStar } from "lucide-react";

function formatIn(timezone: string): { time: string; hour: number } | null {
  try {
    const now = new Date();
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(now);
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      }).format(now),
    );
    return { time, hour };
  } catch {
    return null;
  }
}

/**
 * Live "client's local time" chip for the admin — ticks every 30s and warns
 * when it's probably the middle of their night.
 */
export function LocalTime({
  timezone,
  className,
}: {
  timezone: string | null;
  className?: string;
}) {
  const [now, setNow] = useState<{ time: string; hour: number } | null>(null);

  useEffect(() => {
    if (!timezone) return;
    const update = () => setNow(formatIn(timezone));
    update();
    const timer = setInterval(update, 30_000);
    return () => clearInterval(timer);
  }, [timezone]);

  if (!timezone || !now) return null;
  const asleep = now.hour >= 23 || now.hour < 7;
  const city = timezone.split("/").pop()?.replaceAll("_", " ") ?? timezone;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        asleep ? "text-amber-500" : "text-muted-foreground",
        className,
      )}
      title={`${timezone} — the client's local time${asleep ? ", likely asleep" : ""}`}
    >
      {asleep ? <MoonStar className="size-3" /> : <Clock className="size-3" />}
      {/* A phone header has room for the time, not the sentence; the moon
          still says "asleep", and the title carries the rest. */}
      <span className="hidden sm:inline">Local time </span>
      <span className="whitespace-nowrap tabular-nums">{now.time}</span>
      <span className="hidden sm:inline"> · {city}</span>
      {asleep && <span className="hidden sm:inline"> — likely asleep</span>}
    </span>
  );
}
