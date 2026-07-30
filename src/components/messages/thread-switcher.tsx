"use client";

import { useState } from "react";
import useSWR from "swr";
import type { MessageView, ThreadPage } from "@/lib/dal/messages";
import { MessageThread } from "./message-thread";
import { cn } from "@/lib/utils";
import { MessagesSquare, FolderKanban, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

export type ThreadOption = { id: string; projectName: string; unread: number };

/**
 * Client-side chat hub: pick the general thread ("Chat with Avix Digital") or
 * any of their projects, then talk in that thread.
 */
export function ThreadSwitcher({
  generalUnread,
  projects,
  initialMessages,
  initialHasMore = false,
  initialProjectId = null,
}: {
  generalUnread: number;
  projects: ThreadOption[];
  /** Messages of the initially selected thread (server-rendered). */
  initialMessages: MessageView[];
  initialHasMore?: boolean;
  initialProjectId?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initialProjectId);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  // The starting thread is server-rendered; switching fetches that thread's
  // first page once, then MessageThread polls incrementally from there.
  const { data, isLoading } = useSWR<ThreadPage | null>(
    `/api/messages?${selected ? `projectId=${selected}` : ""}`,
    fetcher,
    {
      revalidateOnFocus: false,
      // Reuse the server-rendered page for the thread we started on.
      fallbackData:
        selected === initialProjectId
          ? { messages: initialMessages, hasMore: initialHasMore }
          : undefined,
    },
  );
  const page: ThreadPage = {
    messages: data?.messages ?? [],
    hasMore: data?.hasMore ?? false,
  };

  const threads = [
    {
      id: null as string | null,
      label: "General chat",
      hint: "Anything at all — questions, ideas, a new job",
      unread: generalUnread,
      icon: MessagesSquare,
    },
    ...projects.map((p) => ({
      id: p.id as string | null,
      label: p.projectName,
      hint: "About this project",
      unread: p.unread,
      icon: FolderKanban,
    })),
  ];

  const active = threads.find((t) => t.id === selected) ?? threads[0];

  return (
    <div className="grid h-[calc(100dvh-13rem)] min-h-[560px] grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      {/* Thread list — scrolls on its own, so it stays put beside a long chat. */}
      <aside
        className={cn(
          "flex min-h-0 flex-col gap-1.5 overflow-y-auto rounded-2xl border bg-card p-3",
          mobilePane === "thread" && "hidden lg:flex",
        )}
      >
        <p className="px-1 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Conversations
        </p>
        {threads.map((thread) => {
          const isActive = thread.id === selected;
          return (
            <button
              key={thread.id ?? "general"}
              type="button"
              onClick={() => {
                setSelected(thread.id);
                setMobilePane("thread");
              }}
              className={cn(
                "flex w-full shrink-0 items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
                isActive
                  ? "border-primary/40 bg-brand-tint"
                  : "border-transparent bg-muted/40 hover:bg-muted",
              )}
            >
              <thread.icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{thread.label}</span>
                  {thread.unread > 0 && (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">
                      {thread.unread}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {thread.hint}
                </span>
              </span>
            </button>
          );
        })}
      </aside>

      {/* Active thread — header pinned, messages scroll, composer docked. */}
      <section
        className={cn(
          "flex min-h-0 flex-col rounded-2xl border bg-card",
          mobilePane === "list" && "hidden lg:flex",
        )}
      >
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
            <h2 className="truncate font-heading text-lg font-semibold">{active.label}</h2>
            <p className="text-sm text-muted-foreground">
              You&apos;re messaging the Avix Digital team directly — we usually reply
              within one business day.
            </p>
          </div>
        </div>
        <div className="min-h-0 flex-1 px-4 pt-2 pb-4">
          {isLoading ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading conversation…
            </p>
          ) : (
            <MessageThread
              key={selected ?? "general"}
              projectId={selected}
              viewerRole="CLIENT"
              initialMessages={page.messages}
              initialHasMore={page.hasMore}
              variant="fill"
            />
          )}
        </div>
      </section>
    </div>
  );
}
