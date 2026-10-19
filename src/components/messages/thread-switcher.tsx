"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { MessageView, ThreadPage } from "@/lib/dal/messages";
import { MessageThread } from "./message-thread";
import { cn } from "@/lib/utils";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
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
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(initialProjectId);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  // Threads opened this visit read as read at once; the refresh that follows
  // the server-side mark confirms it.
  const [opened, setOpened] = useState<Set<string>>(() => new Set([initialProjectId ?? "general"]));
  // Fresh counts from the server supersede the local guess.
  const [seenProps, setSeenProps] = useState({ projects, generalUnread });
  if (seenProps.projects !== projects || seenProps.generalUnread !== generalUnread) {
    setSeenProps({ projects, generalUnread });
    setOpened(new Set([selected ?? "general"]));
  }
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
  const keyboard = useKeyboardInset();

  return (
    // Height is the whole game on a phone. min-h-[560px] applied at every
    // width, so on a 667px-tall handset the pane was ~100px taller than the
    // space left for it: the page itself scrolled, the composer sat below the
    // fold, and you got two nested scroll areas fighting each other. The floor
    // is now only enforced where there is room for it, and the mobile
    // subtraction is smaller because the header above is smaller too.
    <div
      // The floor is gated on available HEIGHT, not width. A phone held
      // landscape is ~375px tall: a 22rem minimum would put us straight back to
      // a pane taller than its container, which is the bug this replaced.
      className="grid h-[calc(100dvh-5rem)] sm:h-[calc(100dvh-10rem)] min-h-0 grid-cols-1 gap-4 [@media(min-height:640px)]:min-h-[22rem] lg:grid-cols-[280px_1fr] [@media(min-width:1024px)_and_(min-height:800px)]:min-h-[560px]"
      // Belt and braces for the keyboard: the meta tag handles browsers that
      // support it, this handles the rest. Where both apply the inset reads 0,
      // so nothing is subtracted twice.
      style={keyboard ? { height: `calc(100dvh - 5rem - ${keyboard}px)` } : undefined}
    >
      {/* Thread list — scrolls on its own, so it stays put beside a long chat. */}
      <aside
        className={cn(
          "surface flex min-h-0 flex-col gap-1 overflow-y-auto p-2.5",
          mobilePane === "thread" && "hidden lg:flex",
        )}
      >
        <p className="px-1 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Conversations
        </p>
        {threads.map((thread) => {
          const isActive = thread.id === selected;
          const unread = opened.has(thread.id ?? "general") ? 0 : thread.unread;
          return (
            <button
              key={thread.id ?? "general"}
              type="button"
              onClick={() => {
                setSelected(thread.id);
                setMobilePane("thread");
                setOpened((prev) => new Set(prev).add(thread.id ?? "general"));
              }}
              className={cn(
                "flex w-full shrink-0 items-center gap-3 rounded-xl p-2.5 text-left transition-colors",
                isActive ? "bg-brand-tint ring-1 ring-primary/30" : "hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl",
                  isActive ? "bg-primary text-white" : "bg-muted text-muted-foreground",
                )}
              >
                <thread.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{thread.label}</span>
                  {unread > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-white">
                      {unread}
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
          "surface flex min-h-0 flex-col overflow-hidden",
          mobilePane === "list" && "hidden lg:flex",
        )}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2.5 sm:items-start sm:gap-3 sm:px-5 sm:py-4">
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
            <p className="hidden text-sm text-muted-foreground sm:block">
              You&apos;re messaging the Avix Digital team directly — we usually reply
              within one business day.
            </p>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-[var(--chat-canvas)] px-2 pt-2 pb-2 sm:px-4 sm:pb-4">
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
              onActivity={() => router.refresh()}
            />
          )}
        </div>
      </section>
    </div>
  );
}
