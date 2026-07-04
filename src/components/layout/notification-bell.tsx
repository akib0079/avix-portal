"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { formatDistanceToNow } from "date-fns";
import { markNotificationsRead } from "@/lib/actions/notifications";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationItem = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationsResponse = {
  unreadCount: number;
  notifications: NotificationItem[];
};

const fetcher = (url: string) =>
  fetch(url).then((r) => (r.ok ? r.json() : null));

export function NotificationBell({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data, mutate } = useSWR<NotificationsResponse | null>(
    "/api/notifications",
    fetcher,
    { refreshInterval: 30_000 },
  );

  const unread = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  async function markAllRead() {
    await markNotificationsRead();
    mutate();
    router.refresh();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Opening the panel marks everything read.
        if (o && unread > 0) markAllRead();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative",
            tone === "dark"
              ? "text-slate-300 hover:bg-sidebar-accent hover:text-white"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-label="Notifications"
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {notifications.some((n) => !n.readAt) && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          ) : (
            notifications.map((n) => {
              const inner = (
                <div
                  className={cn(
                    "border-b px-4 py-3 last:border-b-0",
                    !n.readAt && "bg-brand-tint/40",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && (
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                    <div className={cn("min-w-0", n.readAt && "pl-3.5")}>
                      <p className="text-sm font-medium">{n.title}</p>
                      {n.body && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {n.body}
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        {formatDistanceToNow(new Date(n.createdAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              );
              return n.link ? (
                <Link
                  key={n.id}
                  href={n.link}
                  onClick={() => setOpen(false)}
                  className="block transition-colors hover:bg-muted/50"
                >
                  {inner}
                </Link>
              ) : (
                <div key={n.id}>{inner}</div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
