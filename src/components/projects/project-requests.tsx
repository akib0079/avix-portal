import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { Inbox, CalendarClock, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { toneChip } from "@/lib/tone";

export type ProjectRequestRow = {
  id: string;
  title: string;
  status: string;
  adminNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  milestone: { id: string; title: string } | null;
};

export type ProjectMeetingRow = {
  id: string;
  title: string;
  startsAt: string;
  durationMins: number;
};

const statusTone: Record<string, string> = {
  PENDING: toneChip.warn,
  ACCEPTED: toneChip.good,
  DECLINED: "bg-muted text-muted-foreground",
  COMPLETED: toneChip.good,
};

/**
 * Task requests and upcoming calls for this project. Both relations existed on
 * Project and neither was ever shown here — you had to go to /admin/task-requests
 * and /admin/calendar and filter by eye.
 */
export function ProjectRequests({
  requests,
  meetings,
}: {
  requests: ProjectRequestRow[];
  meetings: ProjectMeetingRow[];
}) {
  return (
    <div className="space-y-6">
      {meetings.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="font-heading mb-3 flex items-center gap-2 text-base font-semibold">
              <CalendarClock className="size-4" /> Upcoming calls
            </h3>
            <ul className="space-y-2">
              {meetings.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{m.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {new Date(m.startsAt).toLocaleString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      · {m.durationMins} min
                    </span>
                  </span>
                  <Link
                    href="/admin/calendar"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Calendar <ArrowUpRight className="size-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <h3 className="font-heading mb-3 flex items-center gap-2 text-base font-semibold">
            <Inbox className="size-4" /> Client requests ({requests.length})
          </h3>

          {requests.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No requests on this project yet. Anything the client sends from the
              portal lands here.
            </p>
          ) : (
            <ul className="space-y-2">
              {requests.map((r) => (
                <li key={r.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link
                      href="/admin/task-requests"
                      className="min-w-0 text-sm font-medium hover:text-primary"
                    >
                      {r.title}
                    </Link>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        statusTone[r.status] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sent {formatDate(r.createdAt)}
                    {r.resolvedAt ? ` · resolved ${formatDate(r.resolvedAt)}` : ""}
                  </p>
                  {r.milestone && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-3 shrink-0" />
                      Became milestone “{r.milestone.title}”
                    </p>
                  )}
                  {r.adminNote && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Note: {r.adminNote}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
