import "server-only";
import { prisma } from "@/lib/prisma";
import { zonedWallTimeToUtc } from "@/lib/tz";

export const AGENCY_TZ_KEY = "agencyTimezone";
export const SLOT_MIN_KEY = "bookingSlotMinutes";
export const BOOKING_URL_KEY = "bookingLocationUrl";

const DEFAULT_TZ = "America/New_York";
const DEFAULT_SLOT = 30;

export type BookingConfig = {
  agencyTimezone: string;
  slotMinutes: number;
  bookingUrl: string | null;
};

export async function getBookingConfig(): Promise<BookingConfig> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [AGENCY_TZ_KEY, SLOT_MIN_KEY, BOOKING_URL_KEY] } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const slot = Number(map[SLOT_MIN_KEY]);
  return {
    agencyTimezone: map[AGENCY_TZ_KEY] || DEFAULT_TZ,
    slotMinutes: Number.isFinite(slot) && slot > 0 ? slot : DEFAULT_SLOT,
    bookingUrl: map[BOOKING_URL_KEY] || null,
  };
}

export async function listAvailabilityWindows() {
  return prisma.availabilityWindow.findMany({
    orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
  });
}

export type OpenSlot = { startIso: string; endIso: string };
export type OpenDay = { dateLabel: string; weekday: number; slots: OpenSlot[] };

/** Add whole calendar days to a Y/M/D triple (tz-independent). */
function addDays(y: number, m: number, d: number, add: number) {
  const dt = new Date(Date.UTC(y, m - 1, d + add));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
    weekday: dt.getUTCDay(),
  };
}

/**
 * Free, future booking slots for the next `daysAhead` days: active availability
 * windows (interpreted in the agency tz) minus already-booked meetings, minus
 * anything sooner than `leadHours`. Slot instants are absolute (UTC) — the UI
 * renders them in whatever timezone it likes.
 */
export async function deriveOpenSlots(opts?: {
  daysAhead?: number;
  leadHours?: number;
}): Promise<{ config: BookingConfig; slots: OpenSlot[] }> {
  const daysAhead = opts?.daysAhead ?? 21;
  const leadMs = (opts?.leadHours ?? 2) * 3_600_000;

  const [config, windows] = await Promise.all([
    getBookingConfig(),
    prisma.availabilityWindow.findMany({ where: { active: true } }),
  ]);
  if (windows.length === 0) return { config, slots: [] };

  const now = Date.now();
  const horizon = new Date(now + daysAhead * 86_400_000);
  const booked = await prisma.meeting.findMany({
    where: { status: "SCHEDULED", startsAt: { gte: new Date(now), lte: horizon } },
    select: { startsAt: true, durationMins: true },
  });
  const busy = booked.map((b) => ({
    start: b.startsAt.getTime(),
    end: b.startsAt.getTime() + b.durationMins * 60_000,
  }));

  // Start from "today" in the agency timezone.
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.agencyTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const tp = Object.fromEntries(todayParts.map((p) => [p.type, p.value]));
  const base = { y: Number(tp.year), m: Number(tp.month), d: Number(tp.day) };

  const slots: OpenSlot[] = [];
  for (let i = 0; i <= daysAhead; i++) {
    const day = addDays(base.y, base.m, base.d, i);
    const dayWindows = windows.filter((w) => w.weekday === day.weekday);
    for (const w of dayWindows) {
      for (let min = w.startMin; min + config.slotMinutes <= w.endMin; min += config.slotMinutes) {
        const start = zonedWallTimeToUtc(
          day.year, day.month, day.day,
          Math.floor(min / 60), min % 60,
          config.agencyTimezone,
        );
        const startMs = start.getTime();
        if (startMs < now + leadMs) continue;
        const endMs = startMs + config.slotMinutes * 60_000;
        const clash = busy.some((b) => startMs < b.end && endMs > b.start);
        if (clash) continue;
        slots.push({ startIso: start.toISOString(), endIso: new Date(endMs).toISOString() });
      }
    }
  }
  slots.sort((a, b) => a.startIso.localeCompare(b.startIso));
  return { config, slots };
}
