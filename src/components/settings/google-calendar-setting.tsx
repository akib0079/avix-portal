"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectGoogleCalendar, syncGoogleCalendar } from "@/lib/actions/google-calendar";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CalendarDays, Loader2, RefreshCw, Link2, Unlink, CheckCircle2 } from "lucide-react";

export function GoogleCalendarSetting({
  connected,
  email,
}: {
  connected: boolean;
  email: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function disconnect() {
    startTransition(async () => {
      const res = await disconnectGoogleCalendar();
      if (res.ok) {
        toast.success("Google Calendar disconnected.");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function sync() {
    startTransition(async () => {
      const res = await syncGoogleCalendar();
      if (res.ok) {
        toast.success(
          res.data?.cancelled
            ? `Synced — ${res.data.cancelled} meeting(s) cancelled from Google.`
            : "Synced — everything is up to date.",
        );
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div>
      <h2 className="font-heading flex items-center gap-2 text-lg font-semibold">
        <CalendarDays className="size-5 text-primary" /> Google Calendar
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Mirror booked meetings to your Google Calendar automatically. Cancelling
        an event in Google can be pulled back with “Sync now”.
      </p>

      {connected ? (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-emerald-500" />
            Connected{email ? ` as ${email}` : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={sync} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <RefreshCw className="size-4" />}
              Sync now
            </Button>
            <Button variant="outline" size="sm" onClick={disconnect} disabled={pending}>
              <Unlink className="size-4" /> Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <Button asChild size="sm">
            <a href="/api/google/connect">
              <Link2 className="size-4" /> Connect Google Calendar
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
