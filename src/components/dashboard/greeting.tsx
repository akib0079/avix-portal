"use client";

import { useSyncExternalStore } from "react";

/**
 * Greeting + live clock, in the viewer's own timezone.
 *
 * The server can't know it (the VPS runs UTC; the admin is not), so the time
 * is read in the browser. useSyncExternalStore gives a null server snapshot,
 * which renders an invisible placeholder of the same shape — no hydration
 * mismatch and no layout jump when the real value lands.
 */

let cached: { minute: number; now: Date } | null = null;

function snapshot(): Date {
  const minute = Math.floor(Date.now() / 60_000);
  if (!cached || cached.minute !== minute) cached = { minute, now: new Date() };
  return cached.now;
}

function subscribe(onChange: () => void) {
  // Re-read on the next minute boundary, then every minute.
  let interval: ReturnType<typeof setInterval> | undefined;
  const timeout = setTimeout(
    () => {
      onChange();
      interval = setInterval(onChange, 60_000);
    },
    60_000 - (Date.now() % 60_000),
  );
  return () => {
    clearTimeout(timeout);
    if (interval) clearInterval(interval);
  };
}

function useNow(): Date | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

function partOfDay(hour: number) {
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function Greeting({ name }: { name: string }) {
  const now = useNow();
  return (
    <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
      <span className={now ? "rise" : "invisible"}>
        {now ? partOfDay(now.getHours()) : "Good afternoon"}
      </span>
      , <span className="text-muted-foreground/70">{name}</span>
    </h1>
  );
}

export function LiveClock() {
  const now = useNow();
  const date = now
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(now)
    : "Wednesday, 30 September";
  const time = now
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(now)
    : "12:00 PM";
  return (
    <p className="eyebrow flex items-center gap-2">
      <span className="signal size-1.5 text-emerald-500" aria-hidden />
      <span className={now ? "" : "invisible"}>
        {date}
        <span className="mx-2 text-muted-foreground/40">/</span>
        <span className="tabular-nums">{time}</span>
      </span>
    </p>
  );
}
