"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { ConversationSummary, ThreadPage } from "@/lib/dal/messages";
import { MessageThread } from "./message-thread";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { formatDistanceToNow } from "date-fns";
import {
  MessagesSquare,
  FolderKanban,
  Inbox,
  Search,
  ArrowLeft,
  Loader2,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

function threadKey(c: { clientId: string; projectId: string | null }) {
  return `${c.clientId}::${c.projectId ?? "general"}`;
}

/**
 * Unified inbox: every client conversation (general + per-project).
 *
 * Two independently scrolling panes inside one viewport-height frame — the
 * conversation list stays put while a long thread scrolls, and the composer
 * stays docked at the bottom. Small screens show one pane at a time.
 */
export function AdminInbox({
  conversations,
}: {
  conversations: ConversationSummary[];
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(
    conversations[0] ? threadKey(conversations[0]) : null,
  );
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");

  const active = conversations.find((c) => threadKey(c) === selectedKey) ?? null;
  const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (unreadOnly && c.unread === 0) return false;
      if (!needle) return true;
      const hay = `${c.clientName} ${c.company ?? ""} ${
        c.projectName ?? "general chat"
      } ${c.preview}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [conversations, search, unreadOnly]);

  // Fetch the selected thread's first page; MessageThread polls onwards from
  // there, so the thread is never fetched twice on a timer.
  const threadQuery = active
    ? `/api/messages?clientId=${active.clientId}${active.projectId ? `&projectId=${active.projectId}` : ""}`
    : null;
  const { data, isLoading } = useSWR<ThreadPage | null>(threadQuery, fetcher, {
    revalidateOnFocus: false,
  });
  const page: ThreadPage = {
    messages: data?.messages ?? [],
    hasMore: data?.hasMore ?? false,
  };

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Inbox className="size-6 text-muted-foreground" />
        </div>
        <p className="mt-4 font-medium">No conversations yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When a client messages you — from a project or their general chat — it
          lands here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100dvh-13rem)] min-h-[560px] grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
      {/* Conversation list — its own scroll container, so it never runs away
          with the page. */}
      <aside
        className={cn(
          "flex min-h-0 flex-col rounded-2xl border bg-card",
          mobilePane === "thread" && "hidden lg:flex",
        )}
      >
        <div className="space-y-2 border-b p-3">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setUnreadOnly((v) => !v)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                unreadOnly
                  ? "border-primary bg-brand-tint text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Unread{totalUnread > 0 ? ` (${totalUnread})` : ""}
            </button>
            <span className="text-xs text-muted-foreground">
              {visible.length} of {conversations.length}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing matches that.
            </p>
          ) : (
            visible.map((c) => {
              const key = threadKey(c);
              const isActive = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedKey(key);
                    setMobilePane("thread");
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                    isActive
                      ? "border-primary/40 bg-brand-tint"
                      : "border-transparent bg-muted/40 hover:bg-muted",
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-foreground dark:bg-slate-700 dark:text-white">
                    {initials(c.clientName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{c.clientName}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true })}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      {c.projectId ? (
                        <>
                          <FolderKanban className="size-3 shrink-0" />
                          <span className="truncate">{c.projectName}</span>
                        </>
                      ) : (
                        <>
                          <MessagesSquare className="size-3 shrink-0" />
                          General chat
                        </>
                      )}
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-xs",
                          c.unread > 0
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {c.preview}
                      </span>
                      {c.unread > 0 && (
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">
                          {c.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Active thread — header pinned, messages scroll, composer docked. */}
      <section
        className={cn(
          "flex min-h-0 flex-col rounded-2xl border bg-card",
          mobilePane === "list" && "hidden lg:flex",
        )}
      >
        {active && (
          <>
            <div className="flex items-start gap-3 border-b px-5 py-4">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobilePane("list")}
                aria-label="Back to conversations"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <div className="min-w-0">
                <h2 className="truncate font-heading text-lg font-semibold">
                  {active.clientName}
                  {active.company && (
                    <span className="text-muted-foreground"> · {active.company}</span>
                  )}
                </h2>
                <p className="truncate text-sm text-muted-foreground">
                  {active.projectId ? active.projectName : "General chat (no project)"}
                </p>
              </div>
              <LocalTime timezone={active.timezone} className="ml-auto shrink-0" />
            </div>

            <div className="min-h-0 flex-1 px-4 pt-2 pb-4">
              {isLoading ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading conversation…
                </p>
              ) : (
                <MessageThread
                  key={selectedKey ?? ""}
                  projectId={active.projectId}
                  clientId={active.clientId}
                  viewerRole="ADMIN"
                  initialMessages={page.messages}
                  initialHasMore={page.hasMore}
                  variant="fill"
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
