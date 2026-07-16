"use client";

import type { MeetingView } from "@/lib/dal/meetings";
import { googleCalendarUrl } from "@/lib/calendar-links";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, Video, Download } from "lucide-react";

/** Renders in the CLIENT's browser, so times show in their own locale/zone. */
function when(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function UpcomingMeetings({ meetings }: { meetings: MeetingView[] }) {
  if (meetings.length === 0) return null;

  return (
    <Card className="mb-6 border-primary/20">
      <CardContent className="pt-6">
        <h2 className="font-heading flex items-center gap-2 text-lg font-semibold">
          <CalendarDays className="size-4 text-primary" /> Upcoming meetings
        </h2>
        <ul className="mt-3 divide-y">
          {meetings.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{m.title}</p>
                <p className="text-xs text-muted-foreground">
                  {when(m.startsAt)} · {m.durationMins} min
                  {m.projectName ? ` · ${m.projectName}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {m.meetingUrl && (
                  <Button asChild size="sm">
                    <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer">
                      <Video /> Join
                    </a>
                  </Button>
                )}
                <Button asChild variant="outline" size="sm">
                  <a
                    href={googleCalendarUrl({
                      id: m.id,
                      title: m.title,
                      notes: m.notes,
                      startsAt: new Date(m.startsAt),
                      durationMins: m.durationMins,
                      meetingUrl: m.meetingUrl,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <CalendarDays /> Add to Google
                  </a>
                </Button>
                <Button asChild variant="ghost" size="icon" className="size-8">
                  <a href={`/api/meetings/${m.id}/ics`} title="Download .ics">
                    <Download className="size-4" />
                  </a>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
