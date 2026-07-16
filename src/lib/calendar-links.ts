/**
 * Calendar interop without OAuth: an "Add to Google Calendar" URL and a
 * hand-rolled .ics payload (works with Apple/Outlook too).
 */

export type CalendarEvent = {
  id: string;
  title: string;
  notes?: string | null;
  startsAt: Date;
  durationMins: number;
  meetingUrl?: string | null;
};

/** "20260801T143000Z" — UTC basic format both GCal and ics want. */
function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function eventEnd(event: CalendarEvent): Date {
  return new Date(event.startsAt.getTime() + event.durationMins * 60_000);
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${utcStamp(event.startsAt)}/${utcStamp(eventEnd(event))}`,
    details: [event.notes, event.meetingUrl && `Join: ${event.meetingUrl}`]
      .filter(Boolean)
      .join("\n\n"),
  });
  if (event.meetingUrl) params.set("location", event.meetingUrl);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escapes ics text values (commas, semicolons, newlines). */
function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function icsFile(event: CalendarEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Avix Digital//Portal//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@avixdigital.com`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(event.startsAt)}`,
    `DTEND:${utcStamp(eventEnd(event))}`,
    `SUMMARY:${icsEscape(event.title)}`,
  ];
  if (event.notes) lines.push(`DESCRIPTION:${icsEscape(event.notes)}`);
  if (event.meetingUrl) {
    lines.push(`URL:${event.meetingUrl}`);
    lines.push(`LOCATION:${icsEscape(event.meetingUrl)}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** "Friday, August 1, 2026, 2:30 PM" in a given timezone (UTC fallback). */
export function formatInTimezone(date: Date, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone ?? "UTC",
      dateStyle: "full",
      timeStyle: "short",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      dateStyle: "full",
      timeStyle: "short",
    }).format(date);
  }
}
